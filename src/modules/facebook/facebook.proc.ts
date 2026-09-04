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
