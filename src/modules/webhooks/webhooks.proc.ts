import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

export type SepayResult = {
  duplicate: boolean;
  orderNumber?: string | null;
  orderMatched?: boolean;
  transaction?: unknown;
};
export type FacebookResult = { duplicate: boolean; id: string };
export type OrderPaidItem = {
  name: string;
  quantity: number;
  size?: string | null;
  sizeCounts?: { name: string; qty: number }[] | null;
  flavors?: string[] | null;
};
export type OrderPaidSummary = {
  customerName?: string;
  phone?: string;
  items?: OrderPaidItem[];
};

/** Tầng quản lý stored procedure của domain webhooks. */
@Injectable()
export class WebhookProc {
  constructor(private readonly db: DbService) {}

  async sepay(body: unknown): Promise<SepayResult> {
    const rows = await this.db.sql<{ result: SepayResult }[]>`
      SELECT webhook_sepay(${this.db.json(body ?? {})}::jsonb) AS result`;
    return rows[0].result;
  }

  /** Tóm tắt đơn (khách + món) cho noti Zalo khi auto-PAID. null nếu không thấy đơn. */
  async orderPaidSummary(orderNumber: string): Promise<OrderPaidSummary | null> {
    const rows = await this.db.sql<{ result: OrderPaidSummary | null }[]>`
      SELECT order_paid_noti_summary(${orderNumber}) AS result`;
    return rows[0]?.result ?? null;
  }

  async facebookMessage(body: unknown): Promise<FacebookResult> {
    const rows = await this.db.sql<{ result: FacebookResult }[]>`
      SELECT facebook_message_create(${this.db.json(body ?? {})}::jsonb) AS result`;
    return rows[0].result;
  }
}
