import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/** Cấu hình nghiệp vụ: viết mô tả bán hàng cho 1 sản phẩm. */
export const PRODUCT_DESCRIPTION_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 512,
  // Chỉ vài dòng thông tin 1 sản phẩm (tên + loại + vị + size).
  inputCharLimit: 4000,
};
