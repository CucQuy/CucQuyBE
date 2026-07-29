import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { SPX_ADDRESS_OLD_CONFIG } from './spx-address-old.config';
import { SpxAdminProc } from './spx-admin.proc';
import { createOldMatcher, OldAddr } from './spx-old-match';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'spx-address-old.prompt.md');
const CITY_PROMPT = loadPrompt(__dirname, 'spx-city-grounded.prompt.md');
const WARD_PROMPT = loadPrompt(__dirname, 'spx-ward-grounded.prompt.md');

/**
 * Tách địa chỉ tự do → Tỉnh/Quận/Xã hệ CŨ (3 cấp) chuẩn danh mục SPX (bảng spx_*_old).
 * 3 tầng để phủ tối đa:
 *   1) Rule-based grounded DB (matcher).
 *   2) Claude AI tách state/city/ward từ trí nhớ → SNAP về danh mục.
 *   3) GROUNDED: đơn đã có Tỉnh nhưng thiếu Quận/Huyện → gửi AI DANH SÁCH Quận/Huyện
 *      hợp lệ của tỉnh, AI chỉ được CHỌN trong list (không bịa) → phủ mạnh cột Quận/Huyện.
 * Danh mục nạp 1 lần rồi cache trong process.
 */
@Injectable()
export class SpxAddressOldService {
  private matcher: ReturnType<typeof createOldMatcher> | null = null;

  constructor(
    private readonly ai: AiClientService,
    private readonly proc: SpxAdminProc,
  ) {}

  private async getMatcher(): Promise<ReturnType<typeof createOldMatcher>> {
    if (!this.matcher) {
      const { states, cities, wards } = await this.proc.loadAll();
      this.matcher = createOldMatcher(states, cities, wards);
    }
    return this.matcher;
  }

  /** Trả mảng {state, city, ward} ĐÚNG THỨ TỰ đầu vào (rỗng nếu không chắc). */
  async run(addresses: string[], useAi: boolean): Promise<OldAddr[]> {
    const matcher = await this.getMatcher();
    const clean = addresses.map((a) => String(a ?? '').replace(/\s+/g, ' ').trim());
    const resolved = clean.map((a) => matcher.resolve(a));
    if (!useAi) return resolved;

    // ── Tầng 2: AI tách state/city/ward cho đơn còn thiếu bất kỳ cấp nào ──
    const missIdx = resolved
      .map((r, i) => (!r.state || !r.city || !r.ward ? i : -1))
      .filter((i) => i >= 0);
    if (missIdx.length > 0) {
      const list = missIdx
        .map((i, k) => `${k + 1}. ${clean[i]}`)
        .filter((line) => line.length > 3)
        .join('\n');
      if (list) {
        try {
          const raw = await this.ai.complete(SPX_ADDRESS_OLD_CONFIG, SYSTEM_PROMPT, list);
          const parsed = this.ai.parseJson<{ items?: unknown }>(raw);
          const items = Array.isArray(parsed.items) ? parsed.items : [];
          const aiByK = new Map<number, OldAddr>();
          for (const it of items) {
            const r = (it ?? {}) as Record<string, unknown>;
            const k = typeof r.i === 'number' ? r.i - 1 : -1;
            if (k < 0 || k >= missIdx.length) continue;
            aiByK.set(k, {
              state: this.ai.normalizeStr(r.state) ?? '',
              city: this.ai.normalizeStr(r.city) ?? '',
              ward: this.ai.normalizeStr(r.ward) ?? '',
            });
          }
          missIdx.forEach((oi, k) => {
            const ai = aiByK.get(k);
            if (!ai) return;
            const snapped = matcher.snap(ai, clean[oi]);
            resolved[oi] = {
              state: resolved[oi].state || snapped.state,
              city: resolved[oi].city || snapped.city,
              ward: resolved[oi].ward || snapped.ward,
            };
          });
        } catch {
          // AI lỗi → giữ kết quả rule-based.
        }
      }
    }

    // ── Tầng 3 (GROUNDED): đơn đã có TỈNH nhưng thiếu QUẬN/HUYỆN → AI chọn từ list của tỉnh ──
    const cityMiss = resolved
      .map((r, i) => (r.state && !r.city && (matcher.citiesByState.get(r.state)?.length ?? 0) > 0 ? i : -1))
      .filter((i) => i >= 0);
    if (cityMiss.length > 0) {
      const blocks = cityMiss
        .map((oi, k) => {
          const cities = matcher.citiesByState.get(resolved[oi].state) ?? [];
          const listStr = cities.map((c) => `- ${c}`).join('\n');
          return `### ${k + 1}\nĐịa chỉ: ${clean[oi]}\nTỉnh/Thành: ${resolved[oi].state}\nQuận/Huyện hợp lệ:\n${listStr}`;
        })
        .join('\n\n');
      try {
        const raw = await this.ai.complete(SPX_ADDRESS_OLD_CONFIG, CITY_PROMPT, blocks);
        const parsed = this.ai.parseJson<{ items?: unknown }>(raw);
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        for (const it of items) {
          const r = (it ?? {}) as Record<string, unknown>;
          const k = typeof r.i === 'number' ? r.i - 1 : -1;
          if (k < 0 || k >= cityMiss.length) continue;
          const oi = cityMiss[k];
          const city = matcher.snapCity(this.ai.normalizeStr(r.city) ?? '', resolved[oi].state);
          if (city) resolved[oi] = { ...resolved[oi], city };
        }
      } catch {
        // AI lỗi → để trống cho user chọn dropdown.
      }
    }

    // ── Tầng 4 (GROUNDED): đã có TỈNH+QUẬN/HUYỆN nhưng thiếu XÃ/PHƯỜNG → AI chọn từ list của Quận/Huyện ──
    const wardMiss = resolved
      .map((r, i) => (r.state && r.city && !r.ward && (matcher.wardsByCity.get(r.city)?.length ?? 0) > 0 ? i : -1))
      .filter((i) => i >= 0);
    if (wardMiss.length > 0) {
      const blocks = wardMiss
        .map((oi, k) => {
          const wards = matcher.wardsByCity.get(resolved[oi].city) ?? [];
          const listStr = wards.map((w) => `- ${w}`).join('\n');
          return `### ${k + 1}\nĐịa chỉ: ${clean[oi]}\nTỉnh/Thành: ${resolved[oi].state}\nQuận/Huyện: ${resolved[oi].city}\nPhường/Xã hợp lệ:\n${listStr}`;
        })
        .join('\n\n');
      try {
        const raw = await this.ai.complete(SPX_ADDRESS_OLD_CONFIG, WARD_PROMPT, blocks);
        const parsed = this.ai.parseJson<{ items?: unknown }>(raw);
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        for (const it of items) {
          const r = (it ?? {}) as Record<string, unknown>;
          const k = typeof r.i === 'number' ? r.i - 1 : -1;
          if (k < 0 || k >= wardMiss.length) continue;
          const oi = wardMiss[k];
          const ward = matcher.snapWard(this.ai.normalizeStr(r.ward) ?? '', resolved[oi].city);
          if (ward) resolved[oi] = { ...resolved[oi], ward };
        }
      } catch {
        // AI lỗi → để trống Xã cho user chọn dropdown.
      }
    }

    return resolved;
  }
}
