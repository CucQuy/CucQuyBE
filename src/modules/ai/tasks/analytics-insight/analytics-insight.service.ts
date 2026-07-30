import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { ANALYTICS_INSIGHT_CONFIG } from './analytics-insight.config';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'analytics-insight.prompt.md');

/** Nghiệp vụ: nhận số liệu tổng hợp → Claude trả nhận định kinh doanh (JSON). Chỉ chạy khi user bấm. */
@Injectable()
export class AnalyticsInsightService {
  constructor(private readonly ai: AiClientService) {}

  async run(overview: unknown): Promise<Record<string, unknown>> {
    const input = JSON.stringify(overview ?? {});
    const raw = await this.ai.complete(ANALYTICS_INSIGHT_CONFIG, SYSTEM_PROMPT, input);
    return this.ai.parseJson<Record<string, unknown>>(raw);
  }
}
