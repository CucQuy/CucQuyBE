/**
 * Cấu hình dùng chung cho mọi nghiệp vụ AI.
 * Model mặc định lấy từ env CLAUDE_MODEL (vd claude-haiku-4-5 / claude-sonnet-4-6),
 * fallback claude-opus-4-8. Mỗi nghiệp vụ có thể override trong config riêng.
 */
export const DEFAULT_AI_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

/** Cấu hình 1 nghiệp vụ AI — mỗi task 1 file config theo mẫu này. */
export interface AiTaskConfig {
  /** Model dùng cho nghiệp vụ (mặc định DEFAULT_AI_MODEL). */
  model: string;
  /** Giới hạn token đầu ra. */
  maxTokens: number;
  /** Cắt bớt input (số ký tự) trước khi gửi để tránh vượt context / tốn token. */
  inputCharLimit: number;
}
