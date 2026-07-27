import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { SPX_ADDRESS_CONFIG } from './spx-address.config';
import { SpxAddressResult } from './spx-address.types';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'spx-address.prompt.md');

/** Nghiệp vụ: tách địa chỉ VN lộn xộn → Tỉnh/Xã chuẩn 2025 (dùng khi xuất file tạo đơn SPX). */
@Injectable()
export class SpxAddressService {
  constructor(private readonly ai: AiClientService) {}

  /**
   * Nhận danh sách địa chỉ tự do, trả về mảng {province, ward} ĐÚNG THỨ TỰ đầu vào
   * (rỗng nếu AI không chắc). Kết quả vẫn cần FE snap về đúng chuỗi trong danh mục SPX.
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
}
