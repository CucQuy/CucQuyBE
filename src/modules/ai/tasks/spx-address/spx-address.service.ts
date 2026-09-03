import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { SPX_ADDRESS_CONFIG } from './spx-address.config';
import { SpxAddressResult } from './spx-address.types';
import { SpxAdminNewProc } from './spx-admin-new.proc';
import { createNewMatcher, NewAddr } from './spx-new-match';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'spx-address.prompt.md');
const WARD_PROMPT = loadPrompt(__dirname, 'spx-ward-new-grounded.prompt.md');

/** Nghiệp vụ: tách địa chỉ VN lộn xộn → Tỉnh/Xã chuẩn 2025 (dùng khi xuất file tạo đơn SPX). */
@Injectable()
export class SpxAddressService {
  private matcher: ReturnType<typeof createNewMatcher> | null = null;
  private catalog: { states: string[]; wardsByState: Record<string, string[]> } | null = null;

  constructor(
    private readonly ai: AiClientService,
    private readonly proc: SpxAdminNewProc,
  ) {}

  /** Danh mục hành chính MỚI (Tỉnh → Xã/Phường) cho dropdown sửa tay ở FE. Cache 1 lần. */
  async getCatalog(): Promise<{ states: string[]; wardsByState: Record<string, string[]> }> {
    if (this.catalog) return this.catalog;
    const { states, wards } = await this.proc.loadAll();
    const wardsByState: Record<string, string[]> = {};
    for (const { state, ward } of wards) (wardsByState[state] ??= []).push(ward);
    this.catalog = { states, wardsByState };
    return this.catalog;
  }

  private async getMatcher(): Promise<ReturnType<typeof createNewMatcher>> {
    if (!this.matcher) {
      const { states, wards } = await this.proc.loadAll();
      this.matcher = createNewMatcher(states, wards);
    }
    return this.matcher;
  }

  /**
   * Nhận danh sách địa chỉ tự do, trả về mảng {province, ward} ĐÚNG THỨ TỰ đầu vào
   * (rỗng nếu AI không chắc). Bản THÔ — kết quả vẫn cần snap về danh mục ở phía gọi.
   */
  async run(addresses: string[]): Promise<SpxAddressResult[]> {
    const out: SpxAddressResult[] = addresses.map(() => ({ province: '', ward: '' }));
    const list = addresses
      .map((a, i) => `${i + 1}. ${String(a ?? '').replace(/\s+/g, ' ').trim()}`)
      .filter((line) => line.length > 3)
      .join('\n');
    if (!list) return out;

    const raw = await this.ai.complete(SPX_ADDRESS_CONFIG, SYSTEM_PROMPT, list);
    const parsed = this.ai.parseJson<{ items?: unknown }>(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    for (const it of items) {
      const r = (it ?? {}) as Record<string, unknown>;
      const idx = typeof r.i === 'number' ? r.i - 1 : -1;
      if (idx < 0 || idx >= out.length) continue;
      out[idx] = {
        province: this.ai.normalizeStr(r.province) ?? '',
        ward: this.ai.normalizeStr(r.ward) ?? '',
      };
    }
    return out;
  }

  /**
   * Bản GROUNDED (dùng cho "làm mịn" lưu trên đơn): trả {province, ward} đã SNAP về đúng
   * chuỗi trong danh mục spx_*_new. 3 tầng như bản 3 cấp:
   *   1) Rule-based grounded DB (matcher + alias tỉnh sáp nhập + quận cũ → tỉnh mới).
   *   2) Claude AI tách province/ward từ trí nhớ → snap về danh mục.
   *   3) GROUNDED: đã có Tỉnh nhưng thiếu Xã → gửi AI DANH SÁCH xã hợp lệ của tỉnh, AI chỉ CHỌN.
   */
  async resolveGrounded(addresses: string[], useAi: boolean): Promise<NewAddr[]> {
    const matcher = await this.getMatcher();
    const clean = addresses.map((a) => String(a ?? '').replace(/\s+/g, ' ').trim());
    const resolved = clean.map((a) => matcher.resolve(a));
    if (!useAi) return resolved;

    // ── Tầng 2: AI tách province/ward cho đơn còn thiếu bất kỳ cấp nào ──
    const missIdx = resolved
      .map((r, i) => (!r.province || !r.ward ? i : -1))
      .filter((i) => i >= 0);
    if (missIdx.length > 0) {
      const lines = missIdx
        .map((i, k) => `${k + 1}. ${clean[i]}`)
        .filter((line) => line.length > 3);
      if (lines.length > 0) {
        try {
          const ai = await this.run(missIdx.map((i) => clean[i]));
          missIdx.forEach((oi, k) => {
            const got = ai[k];
            if (!got) return;
            const snapped = matcher.snap(
              { province: got.province, ward: got.ward },
              clean[oi],
            );
            resolved[oi] = {
              province: resolved[oi].province || snapped.province,
              ward: resolved[oi].ward || snapped.ward,
            };
          });
        } catch {
          // AI lỗi → giữ kết quả rule-based.
        }
      }
    }

    // ── Tầng 3 (GROUNDED): có TỈNH nhưng thiếu XÃ/PHƯỜNG → AI chọn từ list xã của tỉnh ──
    const wardMiss = resolved
      .map((r, i) =>
        r.province && !r.ward && (matcher.wardsByState.get(r.province)?.length ?? 0) > 0 ? i : -1,
      )
      .filter((i) => i >= 0);
    if (wardMiss.length > 0) {
      const blocks = wardMiss
        .map((oi, k) => {
          const wards = matcher.wardsByState.get(resolved[oi].province) ?? [];
          const listStr = wards.map((w) => `- ${w}`).join('\n');
          return `### ${k + 1}\nĐịa chỉ: ${clean[oi]}\nTỉnh/Thành: ${resolved[oi].province}\nPhường/Xã hợp lệ:\n${listStr}`;
        })
        .join('\n\n');
      try {
        const raw = await this.ai.complete(SPX_ADDRESS_CONFIG, WARD_PROMPT, blocks);
        const parsed = this.ai.parseJson<{ items?: unknown }>(raw);
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        for (const it of items) {
          const r = (it ?? {}) as Record<string, unknown>;
          const k = typeof r.i === 'number' ? r.i - 1 : -1;
          if (k < 0 || k >= wardMiss.length) continue;
          const oi = wardMiss[k];
          const ward = matcher.snapWard(
            this.ai.normalizeStr(r.ward) ?? '',
            resolved[oi].province,
          );
          if (ward) resolved[oi] = { ...resolved[oi], ward };
        }
      } catch {
        // AI lỗi → để trống Xã cho user chọn dropdown.
      }
    }

    return resolved;
  }
}
