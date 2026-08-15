import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { DineInSession, DineInTable, DineInTableInput } from './dine-in.types';

/** Tầng gọi stored function dine_in_* (raw SQL). Nơi DUY NHẤT chạm this.db.sql. */
@Injectable()
export class DineInProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<Array<{ result: DineInTable[] }>> {
    return this.db.sql<Array<{ result: DineInTable[] }>>`
      SELECT dine_in_table_list() AS result`;
  }

  upsert(input: DineInTableInput): Promise<Array<{ result: DineInTable }>> {
    return this.db.sql<Array<{ result: DineInTable }>>`
      SELECT dine_in_table_upsert(${this.db.json(input)}::jsonb) AS result`;
  }

  remove(id: string): Promise<Array<{ result: { ok: boolean } }>> {
    return this.db.sql<Array<{ result: { ok: boolean } }>>`
      SELECT dine_in_table_delete(${id}) AS result`;
  }

  checkout(orderId: string): Promise<Array<{ result: unknown }>> {
    return this.db.sql<Array<{ result: unknown }>>`
      SELECT dine_in_checkout(${orderId}) AS result`;
  }

  history(
    tableId: string,
    limit: number,
  ): Promise<Array<{ result: DineInSession[] }>> {
    return this.db.sql<Array<{ result: DineInSession[] }>>`
      SELECT dine_in_table_history(${tableId}, ${limit}) AS result`;
  }
}
