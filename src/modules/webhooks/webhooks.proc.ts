import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

export type SepayResult = {
  duplicate: boolean;
  orderNumber?: string | null;
  orderMatched?: boolean;
  transaction?: unknown;
};
export type FacebookResult = { duplicate: boolean; id: string };

/** Tầng quản lý stored procedure của domain webhooks. */
@Injectable()
export class WebhookProc {
  constructor(private readonly db: DbService) {}

  async sepay(body: unknown): Promise<SepayResult> {
    const rows = await this.db.sql<{ result: SepayResult }[]>`
      SELECT webhook_sepay(${this.db.json(body ?? {})}::jsonb) AS result`;
    return rows[0].result;
  }

  async facebookMessage(body: unknown): Promise<FacebookResult> {
    const rows = await this.db.sql<{ result: FacebookResult }[]>`
      SELECT facebook_message_create(${this.db.json(body ?? {})}::jsonb) AS result`;
    return rows[0].result;
  }
}
