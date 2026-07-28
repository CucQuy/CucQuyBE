import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { SPX_ADDRESS_OLD_CONFIG } from './spx-address-old.config';
import { SpxAdminProc } from './spx-admin.proc';
import { createOldMatcher, OldAddr } from './spx-old-match';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'spx-address-old.prompt.md');

/**
 * Tách địa chỉ tự do → Tỉnh/Quận/Xã hệ CŨ (3 cấp) chuẩn danh mục SPX (bảng spx_*_old).
 * Rule-based (grounded bằng DB) trước; đơn còn thiếu → Claude AI, rồi SNAP output AI về
 * đúng chuỗi trong danh mục. Danh mục nạp 1 lần rồi cache trong process.
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

    // Đơn thiếu bất kỳ cấp nào → nhờ AI, rồi snap về danh mục (kèm fallback khớp địa chỉ gốc).
    const missIdx = resolved
      .map((r, i) => (!r.state || !r.city || !r.ward ? i : -1))
      .filter((i) => i >= 0);
    if (missIdx.length === 0) return resolved;

    const list = missIdx
      .map((i, k) => `${k + 1}. ${clean[i]}`)
      .filter((line) => line.length > 3)
      .join('\n');
    if (!list) return resolved;

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
        // Ưu tiên giá trị rule-based đã có; chỉ bù cấp còn trống.
        resolved[oi] = {
          state: resolved[oi].state || snapped.state,
          city: resolved[oi].city || snapped.city,
          ward: resolved[oi].ward || snapped.ward,
        };
      });
    } catch {
      // AI lỗi → giữ kết quả rule-based.
    }
    return resolved;
  }
}
