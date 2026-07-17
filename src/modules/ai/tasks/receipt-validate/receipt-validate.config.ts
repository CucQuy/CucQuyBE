import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/** Cấu hình nghiệp vụ: kiểm tra OCR có phải bill/phiếu mua hàng. */
export const RECEIPT_VALIDATE_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 512,
  inputCharLimit: 8000,
};
