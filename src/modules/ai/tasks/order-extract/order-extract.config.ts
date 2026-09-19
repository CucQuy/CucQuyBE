import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/** Cấu hình nghiệp vụ: quét ảnh đơn khách đặt → dữ liệu điền form tạo đơn. */
export const ORDER_EXTRACT_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 4096,
  // Danh mục sản phẩm + hướng dẫn đi kèm ảnh — đủ cho vài trăm SP.
  inputCharLimit: 40000,
};

/** Tối đa số ảnh 1 lần quét (ảnh chat dài thường cắt 2–3 tấm). */
export const ORDER_EXTRACT_MAX_IMAGES = 4;
