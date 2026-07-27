import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/** Tách địa chỉ VN → Tỉnh/Xã chuẩn. Input là danh sách địa chỉ (nhiều dòng) nên cần limit lớn. */
export const SPX_ADDRESS_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 8192,
  inputCharLimit: 24000,
};
