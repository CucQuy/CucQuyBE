import { Injectable, InternalServerErrorException } from '@nestjs/common';

/**
 * Lưu ảnh trên RiceService (object storage self-hosted) thay cho Firebase Storage.
 * Backend giữ API key (env), upload server-side → trả public URL.
 *   RICE_ENDPOINT = https://api.riceservice.xyz
 *   RICE_BUCKET   = <partition/bucket của tài khoản tiembanhcucquy>
 *   RICE_API_KEY  = rsk_...
 */
@Injectable()
export class ImagesService {
  private readonly endpoint = (process.env.RICE_ENDPOINT || '').replace(/\/+$/, '');
  private readonly bucket = process.env.RICE_BUCKET || '';
  private readonly apiKey = process.env.RICE_API_KEY || '';

  private assertConfigured(): void {
    if (!this.endpoint || !this.bucket || !this.apiKey) {
      throw new InternalServerErrorException(
        'Thiếu cấu hình RiceService: RICE_ENDPOINT / RICE_BUCKET / RICE_API_KEY',
      );
    }
  }

  /** Upload file lên RiceService, trả public URL. `path` = key (vd products/<id>_<ts>.jpg). */
  async upload(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    path: string,
  ): Promise<string> {
    this.assertConfigured();
    const form = new FormData();
    const blob = new Blob([new Uint8Array(file.buffer)], {
      type: file.mimetype || 'application/octet-stream',
    });
    form.append('file', blob, file.originalname || path.split('/').pop() || 'file');

    const res = await fetch(
      `${this.endpoint}/${this.bucket}?key=${encodeURIComponent(path)}`,
      { method: 'POST', headers: { 'x-api-key': this.apiKey }, body: form },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `RiceService upload lỗi ${res.status}: ${detail.slice(0, 200)}`,
      );
    }
    const j = (await res.json()) as { url?: string };
    return j.url || `${this.endpoint}/${this.bucket}/${path}`;
  }

  /** Xoá file theo URL. No-op nếu không phải URL RiceService (vd link Firebase cũ). */
  async remove(url: string): Promise<void> {
    if (!url) return;
    const key = this.parseKey(url);
    if (!key) return;
    this.assertConfigured();
    await fetch(`${this.endpoint}/${this.bucket}/${key}`, {
      method: 'DELETE',
      headers: { 'x-api-key': this.apiKey },
    }).catch(() => {});
  }

  /** Trích key từ URL RiceService (https://<endpoint>/<bucket>/<key>). */
  private parseKey(url: string): string | undefined {
    try {
      const u = new URL(url);
      const prefix = `/${this.bucket}/`;
      if (!u.pathname.startsWith(prefix)) return undefined; // link Firebase cũ → bỏ qua
      const key = u.pathname.slice(prefix.length);
      return key ? decodeURIComponent(key) : undefined;
    } catch {
      return undefined;
    }
  }
}
