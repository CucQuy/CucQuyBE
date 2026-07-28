import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { SPX_WARD_CONFIG } from './spx-ward.config';
import { SpxWardInput } from './spx-ward.types';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'spx-ward.prompt.md');

/**
 * Nghiệp vụ: chọn Phường/Xã chuẩn 2025 cho địa chỉ đã biết Tỉnh, GROUNDED bằng danh
 * sách xã hợp lệ của tỉnh (AI chỉ được chép từ list → không bịa). Dùng cho các đơn mà
 * bước tách địa chỉ đầu tiên đã ra Tỉnh nhưng còn thiếu Xã (thường do tên xã/huyện cũ).
 */
@Injectable()
export class SpxWardService {
  constructor(private readonly ai: AiClientService) {}

  /** Trả mảng tên Xã ĐÚNG THỨ TỰ input (rỗng nếu AI không chọn được). Vẫn cần FE snap lại. */
  async run(items: SpxWardInput[]): Promise<string[]> {
    const out: string[] = items.map(() => '');
    const blocks = items
      .map((it, i) => {
        const addr = String(it?.address ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        const wards = Array.isArray(it?.wards) ? it.wards : [];
        if (!addr || !it?.province || wards.length === 0) return '';
        const list = wards.map((w) => `- ${w}`).join('\n');
        return `### ${i + 1}\nĐịa chỉ: ${addr}\nTỉnh/Thành: ${it.province}\nPhường/Xã hợp lệ:\n${list}`;
      })
      .filter((b) => b.length > 0)
      .join('\n\n');
    if (!blocks) return out;

    const raw = await this.ai.complete(SPX_WARD_CONFIG, SYSTEM_PROMPT, blocks);
    const parsed = this.ai.parseJson<{ items?: unknown }>(raw);
    const arr = Array.isArray(parsed.items) ? parsed.items : [];
    for (const it of arr) {
      const r = (it ?? {}) as Record<string, unknown>;
      const idx = typeof r.i === 'number' ? r.i - 1 : -1;
      if (idx < 0 || idx >= out.length) continue;
      out[idx] = this.ai.normalizeStr(r.ward) ?? '';
    }
    return out;
  }
}
