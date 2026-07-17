import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { StockReceiptStructured } from '../../ai.types';
import { RECEIPT_STRUCTURE_CONFIG } from './receipt-structure.config';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'receipt-structure.prompt.md');

/** Nghiệp vụ: cấu trúc hoá OCR bill + phân loại dòng (NVL/Tài sản/Vận hành). */
@Injectable()
export class ReceiptStructureService {
  constructor(private readonly ai: AiClientService) {}

  async run(ocrText: string): Promise<StockReceiptStructured> {
    const raw = await this.ai.complete(
      RECEIPT_STRUCTURE_CONFIG,
      SYSTEM_PROMPT,
      ocrText,
    );
    const parsed = this.ai.parseJson<Partial<StockReceiptStructured>>(raw);
    if (!Array.isArray(parsed.lineItems)) parsed.lineItems = [];

    parsed.supplierName = this.ai.normalizeStr(parsed.supplierName);
    parsed.supplierPhone = this.ai.normalizeStr(parsed.supplierPhone);
    parsed.supplierAddress = this.ai.normalizeStr(parsed.supplierAddress);
    parsed.invoiceNumber = this.ai.normalizeStr(parsed.invoiceNumber);

    // Chuẩn hoá SĐT NCC (giữ logic cũ).
    if (parsed.supplierPhone) {
      const onlyDigitsPlus = parsed.supplierPhone.replace(/[\s.\-()]/g, '');
      parsed.supplierPhone = /^\+?\d{8,15}$/.test(onlyDigitsPlus)
        ? onlyDigitsPlus
        : parsed.supplierPhone;
    }

    return parsed as StockReceiptStructured;
  }
}
