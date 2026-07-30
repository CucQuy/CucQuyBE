import { AiTaskConfig, DEFAULT_AI_MODEL } from '../../core/ai.config';

/** Phân tích số liệu kinh doanh → nhận định. Input là JSON tổng hợp (không lớn). */
export const ANALYTICS_INSIGHT_CONFIG: AiTaskConfig = {
  model: DEFAULT_AI_MODEL,
  maxTokens: 4096,
  inputCharLimit: 40000,
};
