import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Dòng trả về từ transaction_* (snake_case khớp cột bảng). */
export type TransactionRow = {
  id: string;
  sepay_id: string | number | null;
  gateway: string | null;
  transaction_date: string | null;
  account_number: string | null;
  code: string | null;
  content: string | null;
  transfer_type: string | null;
  transfer_amount: string | number | null;
  accumulated: string | number | null;
  sub_account: string | null;
  reference_code: string | null;
  description: string | null;
  order_number: string | null;
  is_external: boolean | null;
  received_at: string | Date | null;
  created_at: string | Date | null;
};

/**
 * Tầng quản lý stored procedure của domain transactions.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class TransactionProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<TransactionRow[]> {
    return this.db.sql<TransactionRow[]>`SELECT * FROM transaction_list()`;
  }

  listByOrder(orderNumber: string): Promise<TransactionRow[]> {
    return this.db
      .sql<TransactionRow[]>`SELECT * FROM transaction_list_by_order(${orderNumber})`;
  }

  markExternal(id: string, isExternal: boolean): Promise<unknown> {
    return this.db.sql`SELECT * FROM transaction_mark_external(${id}, ${isExternal})`;
  }

  linkOrder(id: string, orderNumber: string): Promise<unknown> {
    return this.db.sql`SELECT * FROM transaction_link_order(${id}, ${orderNumber})`;
  }

  createFromSepay(
    body: unknown,
  ): Promise<{ result: { duplicate: boolean; transaction: TransactionRow } }[]> {
    return this.db.sql<{ result: { duplicate: boolean; transaction: TransactionRow } }[]>`
      SELECT transaction_create_from_sepay(${this.db.json(body ?? {})}::jsonb) AS result`;
  }
}
