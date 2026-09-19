import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { PRODUCT_DESCRIPTION_CONFIG } from './product-description.config';
import { ProductForDescription } from './product-description.types';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'product-description.prompt.md');

/** Độ dài tối đa mô tả trả về (cắt cứng nếu AI viết lố). */
const MAX_LEN = 240;

/** Nghiệp vụ: gợi ý mô tả bán hàng cho 1 sản phẩm (nút "Gợi ý bằng AI" ở form SP). */
@Injectable()
export class ProductDescriptionService {
  constructor(private readonly ai: AiClientService) {}

  /**
   * Đưa tên + loại + vị + size (+ mô tả cũ) cho AI viết 1–2 câu mô tả cho khách.
   * Trả chuỗi đã trim + cắt độ dài; rỗng nếu AI không trả được gì dùng được.
   */
  async run(input: ProductForDescription): Promise<string> {
    const name = (input?.name ?? '').trim();
    if (!name) return '';

    // Mỗi dòng 1 thông tin — ngắn, dễ cho AI bám sát, không bịa thêm.
    const lines = [
      `Tên: ${name}`,
      `Loại: ${(input.typeLabel ?? '').trim() || 'Bánh'}`,
      input.flavors?.length ? `Vị: ${input.flavors.join(', ')}` : null,
      input.sizes?.length ? `Size: ${input.sizes.join(', ')}` : null,
      input.current?.trim() ? `Mô tả cũ: ${input.current.trim()}` : null,
    ].filter((l): l is string => !!l);

    const raw = await this.ai.complete(
      PRODUCT_DESCRIPTION_CONFIG,
      SYSTEM_PROMPT,
      lines.join('\n'),
    );
    const parsed = this.ai.parseJson<{ description?: unknown }>(raw);
    const description = this.ai.normalizeStr(parsed.description) ?? '';
    return description.slice(0, MAX_LEN);
  }
}
