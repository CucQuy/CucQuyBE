import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Hàng (snake_case) trả ra từ stored function. */
export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  created_at: Date | string | null;
};

const COLS = `id, name, phone, created_at`;

/**
 * Tầng quản lý stored procedure của domain customers.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class CustomerProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<CustomerRow[]> {
    return this.db
      .sql<CustomerRow[]>`SELECT ${this.db.sql.unsafe(COLS)} FROM customer_list()`;
  }

  create(data: unknown): Promise<CustomerRow[]> {
    return this.db.sql<CustomerRow[]>`
      SELECT ${this.db.sql.unsafe(COLS)}
      FROM customer_create(${this.db.json(data ?? {})}::jsonb)`;
  }

  update(id: string, data: unknown): Promise<unknown> {
    return this.db.sql`
      SELECT 1 FROM customer_update(${id}, ${this.db.json(data ?? {})}::jsonb)`;
  }

  delete(id: string): Promise<unknown> {
    return this.db.sql`SELECT customer_delete(${id})`;
  }
}
