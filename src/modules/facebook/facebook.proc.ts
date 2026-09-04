import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** 1 người đã inbox fanpage (bảng facebook_contacts). */
export interface FacebookContact {
  psid: string;
  name: string;
  profilePic: string;
  customerId: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  messageCount: number;
  optedInAt: string | null;
  /** Còn trong cửa sổ 24h kể từ tin cuối của khách → nhắn tự do được. */
  inWindow: boolean;
  minutesLeft: number;
}

/** Tầng DB cho Facebook Messenger — nơi DUY NHẤT gọi stored function của domain này. */
@Injectable()
export class FacebookProc {
  constructor(private readonly db: DbService) {}

  async upsertContact(data: Record<string, unknown>): Promise<void> {
    await this.db.sql`SELECT facebook_contact_upsert(${this.db.json(data)}::jsonb)`;
  }

  async addMessage(data: Record<string, unknown>): Promise<void> {
    await this.db.sql`SELECT facebook_message_add(${this.db.json(data)}::jsonb)`;
  }

  // ── Bình luận fanpage (086) ──────────────────────────────
  async upsertPost(data: Record<string, unknown>): Promise<void> {
    await this.db.sql`SELECT facebook_post_upsert(${this.db.json(data)}::jsonb)`;
  }

  async upsertComment(data: Record<string, unknown>): Promise<void> {
    await this.db.sql`SELECT facebook_comment_upsert(${this.db.json(data)}::jsonb)`;
  }

  async listComments(
    filter: string,
    limit: number,
    offset: number,
  ): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> | null }[]>`
      SELECT facebook_comment_list(${filter}, ${limit}, ${offset}) AS data`;
    return row?.data ?? { items: [], counts: { total: 0, pending: 0, hidden: 0, replied: 0 } };
  }

  /** hidden/replied = null → giữ nguyên giá trị cũ. */
  async markComment(
    id: string,
    hidden: boolean | null,
    replied: boolean | null,
    auto: string | null,
  ): Promise<void> {
    await this.db.sql`SELECT facebook_comment_mark(${id}, ${hidden}, ${replied}, ${auto})`;
  }

  async deleteComment(id: string): Promise<void> {
    await this.db.sql`SELECT facebook_comment_delete(${id})`;
  }

  async commentConfig(): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> | null }[]>`
      SELECT facebook_config_get() AS data`;
    return row?.data ?? {};
  }

  async saveCommentConfig(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> | null }[]>`
      SELECT facebook_config_save(${this.db.json(data)}::jsonb) AS data`;
    return row?.data ?? {};
  }

  async listContacts(
    filter: string,
    limit: number,
    offset: number,
  ): Promise<{ items: FacebookContact[]; counts: Record<string, number> }> {
    const [row] = await this.db.sql<{ data: { items: FacebookContact[]; counts: Record<string, number> } | null }[]>`
      SELECT facebook_contact_list(${filter}, ${limit}, ${offset}) AS data`;
    return row?.data ?? { items: [], counts: { total: 0, inWindow: 0, optIn: 0 } };
  }
}
