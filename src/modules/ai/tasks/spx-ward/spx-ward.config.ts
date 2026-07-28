import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/**
 * Chọn Phường/Xã từ ĐÚNG danh mục của tỉnh (grounded) — input kèm cả list xã hợp lệ
 * nên cần char limit lớn; output ngắn (chỉ tên xã) nên maxTokens nhỏ.
 */
export const SPX_WARD_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 2048,
  inputCharLimit: 120000,
};
