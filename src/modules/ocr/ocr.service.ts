import { Injectable } from '@nestjs/common';

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

@Injectable()
export class OcrService {
  private getVisionApiKey(): string {
    const k = String(process.env.VISION_API_KEY ?? '').trim();
    if (!k) throw new Error('Thiếu VISION_API_KEY trong môi trường (.env).');
    return k;
  }

  /** Lỗi Vision tạm thời (nên retry): timeout backend Google / quá tải / 5xx. */
  private isTransient(msg: string): boolean {
    const m = msg.toLowerCase();
    return (
      m.includes('deadline') ||
      m.includes('try again') ||
      m.includes('unavailable') ||
      m.includes('timeout') ||
      m.includes('internal error')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * `content`: base64 thuần (không có prefix data:image/...).
   * Retry tối đa 3 lần khi Vision lỗi tạm thời (deadline/5xx) — ảnh bill nặng hay
   * làm Vision backend timeout, thử lại thường qua.
   */
  async extractText(content: string): Promise<string> {
    const key = this.getVisionApiKey();
    const MAX_ATTEMPTS = 3;
    let lastErr: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await fetch(`${VISION_ENDPOINT}?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [
              {
                image: { content },
                features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
              },
            ],
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          const err = new Error(`Vision API lỗi ${res.status}: ${errBody.slice(0, 500)}`);
          // 5xx = transient → retry; 4xx = lỗi cố định → ném luôn.
          if (res.status >= 500) throw err;
          throw Object.assign(err, { fatal: true });
        }

        const data = (await res.json()) as {
          responses?: Array<{
            fullTextAnnotation?: { text?: string };
            textAnnotations?: Array<{ description?: string }>;
            error?: { message?: string };
          }>;
        };

        const first = data.responses?.[0];
        if (first?.error?.message) {
          throw new Error(`Vision: ${first.error.message}`);
        }

        const fromDoc = first?.fullTextAnnotation?.text?.trim();
        if (fromDoc) return fromDoc;
        return first?.textAnnotations?.[0]?.description?.trim() || '';
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        const fatal = (e as { fatal?: boolean })?.fatal === true;
        if (fatal || attempt === MAX_ATTEMPTS || !this.isTransient(lastErr.message)) {
          throw lastErr;
        }
        await this.sleep(700 * attempt); // backoff: 700ms, 1400ms
      }
    }
    throw lastErr ?? new Error('Vision: lỗi không xác định');
  }
}
