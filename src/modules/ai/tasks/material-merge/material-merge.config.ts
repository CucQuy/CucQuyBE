import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/** Cấu hình nghiệp vụ: gợi ý gộp NVL trùng bằng AI. */
export const MATERIAL_MERGE_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 4096,
  inputCharLimit: 24000,
};
