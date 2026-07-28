import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/** Tách địa chỉ VN → Tỉnh/Quận/Xã hệ CŨ (3 cấp). Input nhiều dòng nên limit lớn. */
export const SPX_ADDRESS_OLD_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 8192,
  inputCharLimit: 24000,
};
