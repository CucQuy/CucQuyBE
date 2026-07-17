import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AiTaskConfig } from './ai.config';

/**
 * Client AI dùng chung (Claude/Anthropic) cho mọi nghiệp vụ.
 * Chỉ lo phần hạ tầng: khởi tạo client, gọi model, parse text/JSON an toàn.
 * Logic từng nghiệp vụ (prompt, validate output) nằm ở service riêng của task.
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY is not set in the environment.');
      throw new Error('Thiếu ANTHROPIC_API_KEY trong môi trường.');
    }
    if (!this.client) this.client = new Anthropic({ apiKey });
    return this.client;
  }

  /**
   * Gọi 1 lượt: system prompt + user content, trả về text block đầu tiên.
   * `user` tự cắt theo config.inputCharLimit.
   */
  async complete(
    config: AiTaskConfig,
    system: string,
    user: string,
  ): Promise<string> {
    const resp = await this.getClient().messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system,
      messages: [{ role: 'user', content: user.slice(0, config.inputCharLimit) }],
    });
    return this.firstText(resp);
  }

  /** Lấy text từ block đầu tiên của response. */
  private firstText(resp: Anthropic.Message): string {
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('AI không trả về nội dung text.');
    }
    return block.text;
  }

  /** Parse JSON bền: bỏ ```json fence, hoặc cắt từ '{' đến '}' nếu lẫn chữ thừa. */
  parseJson<T>(raw: string): T {
    let s = raw.trim();
    const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fence) s = fence[1].trim();
    try {
      return JSON.parse(s) as T;
    } catch {
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1)) as T;
      throw new Error('AI trả về không phải JSON hợp lệ.');
    }
  }

  /** Chuẩn hoá chuỗi: trim, rỗng → null. */
  normalizeStr(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t : null;
  }
}
