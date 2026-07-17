import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/** Cấu hình nghiệp vụ: cấu trúc hoá bill + phân loại dòng (NVL/Tài sản/Vận hành). */
export const RECEIPT_STRUCTURE_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 4096,
  inputCharLimit: 12000,
};
