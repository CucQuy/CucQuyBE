import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { BillValidationResult } from '../../ai.types';
import { RECEIPT_VALIDATE_CONFIG } from './receipt-validate.config';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'receipt-validate.prompt.md');

/** Nghiệp vụ: OCR text có phải chứng từ mua/bán hàng không. */
@Injectable()
export class ReceiptValidateService {
  constructor(private readonly ai: AiClientService) {}

  async run(ocrText: string): Promise<BillValidationResult> {
    const raw = await this.ai.complete(
      RECEIPT_VALIDATE_CONFIG,
      SYSTEM_PROMPT,
      ocrText,
    );
    const p = this.ai.parseJson<Record<string, unknown>>(raw);
    return {
      isLikelyReceipt: Boolean(p.isLikelyReceipt ?? p.isLikelyPurchaseReceipt),
      confidence:
        typeof p.confidence === 'number'
          ? Math.max(0, Math.min(1, p.confidence))
          : 0,
      reasonVi:
        typeof p.reasonVi === 'string' ? p.reasonVi : String(p.reason ?? ''),
    };
  }
}
