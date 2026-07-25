import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

export type ManualExpenseRow = {
  id: string;
  date: string | Date | null;
  amount: string | number | null;
  category: string | null;
  spread_months: number | null;
  note: string | null;
  created_at: string | Date | null;
  source: string | null;
  transaction_id: string | null;
};

@Injectable()
export class ManualExpenseProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<ManualExpenseRow[]> {
    return this.db.sql<ManualExpenseRow[]>`SELECT * FROM manual_expense_list()`;
  }

  upsert(body: unknown): Promise<ManualExpenseRow[]> {
    return this.db
      .sql<ManualExpenseRow[]>`SELECT * FROM manual_expense_upsert(${this.db.json(body ?? {})}::jsonb)`;
  }

  remove(id: string): Promise<unknown> {
    return this.db.sql`SELECT manual_expense_delete(${id})`;
  }
}
