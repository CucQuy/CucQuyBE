import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import type { TiktokAccount, TiktokPublish, TiktokTokens } from './tiktok.types';

/** Tầng DB cho TikTok — nơi DUY NHẤT gọi stored function của domain này. */
@Injectable()
export class TiktokProc {
  constructor(private readonly db: DbService) {}

  // ── Tài khoản ────────────────────────────────────────────
  /** null = chưa nối tài khoản nào. */
  async account(): Promise<TiktokAccount | null> {
    const [row] = await this.db.sql<{ data: TiktokAccount | null }[]>`
      SELECT tiktok_account_get() AS data`;
    return row?.data ?? null;
  }

  /** Token để gọi TikTok — không bao giờ trả thẳng ra controller. */
  async tokens(): Promise<TiktokTokens | null> {
    const [row] = await this.db.sql<{ data: TiktokTokens | null }[]>`
      SELECT tiktok_account_tokens() AS data`;
    return row?.data ?? null;
  }

  async saveAccount(data: Record<string, unknown>): Promise<TiktokAccount | null> {
    const [row] = await this.db.sql<{ data: TiktokAccount | null }[]>`
      SELECT tiktok_account_save(${this.db.json(data)}::jsonb) AS data`;
    return row?.data ?? null;
  }

  async deleteAccount(): Promise<void> {
    await this.db.sql`SELECT tiktok_account_delete()`;
  }

  // ── Video ────────────────────────────────────────────────
  async upsertVideo(data: Record<string, unknown>): Promise<void> {
    await this.db.sql`SELECT tiktok_video_upsert(${this.db.json(data)}::jsonb)`;
  }

  async listVideos(limit: number, offset: number): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> | null }[]>`
      SELECT tiktok_video_list(${limit}, ${offset}) AS data`;
    return row?.data ?? { items: [], totals: {} };
  }

  // ── Đăng video ───────────────────────────────────────────
  async savePublish(data: Record<string, unknown>): Promise<TiktokPublish | null> {
    const [row] = await this.db.sql<{ data: TiktokPublish | null }[]>`
      SELECT tiktok_publish_save(${this.db.json(data)}::jsonb) AS data`;
    return row?.data ?? null;
  }

  async getPublish(id: string): Promise<TiktokPublish | null> {
    const [row] = await this.db.sql<{ data: TiktokPublish | null }[]>`
      SELECT tiktok_publish_get(${id}) AS data`;
    return row?.data ?? null;
  }

  /** status/publishId/videoId/error rỗng → giữ nguyên giá trị cũ. */
  async markPublish(
    id: string,
    status: string,
    publishId: string,
    videoId: string,
    error: string,
  ): Promise<void> {
    await this.db.sql`SELECT tiktok_publish_mark(${id}, ${status}, ${publishId}, ${videoId}, ${error})`;
  }

  async listPublishes(limit: number, offset: number): Promise<TiktokPublish[]> {
    const [row] = await this.db.sql<{ data: TiktokPublish[] | null }[]>`
      SELECT tiktok_publish_list(${limit}, ${offset}) AS data`;
    return Array.isArray(row?.data) ? row.data : [];
  }

  async duePublishes(): Promise<TiktokPublish[]> {
    const [row] = await this.db.sql<{ data: TiktokPublish[] | null }[]>`
      SELECT tiktok_publish_due() AS data`;
    return Array.isArray(row?.data) ? row.data : [];
  }

  async pendingPublishes(): Promise<TiktokPublish[]> {
    const [row] = await this.db.sql<{ data: TiktokPublish[] | null }[]>`
      SELECT tiktok_publish_pending() AS data`;
    return Array.isArray(row?.data) ? row.data : [];
  }

  async deletePublish(id: string): Promise<void> {
    await this.db.sql`SELECT tiktok_publish_delete(${id})`;
  }
}
