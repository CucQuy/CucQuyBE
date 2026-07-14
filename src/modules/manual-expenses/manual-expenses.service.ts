import { Injectable } from '@nestjs/common';
import { ManualExpenseProc, ManualExpenseRow } from './manual-expenses.proc';
import { ManualExpense } from './manual-expenses.types';

const toDate = (v: string | Date | null): string => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const mapRow = (r: ManualExpenseRow): ManualExpense => ({
  id: r.id,
  date: toDate(r.date),
  amount: Number(r.amount) || 0,
  category: r.category ?? 'other',
  spreadMonths: Number(r.spread_months) || 1,
  note: r.note ?? null,
  createdAt:
    r.created_at instanceof Date
      ? r.created_at.toISOString()
      : String(r.created_at ?? ''),
});

@Injectable()
export class ManualExpensesService {
  constructor(private readonly proc: ManualExpenseProc) {}

  async list(): Promise<ManualExpense[]> {
    return (await this.proc.list()).map(mapRow);
  }

  async upsert(body: unknown): Promise<ManualExpense> {
    const rows = await this.proc.upsert(body);
    return mapRow(rows[0]);
  }

  async remove(id: string): Promise<void> {
    await this.proc.remove(id);
  }
}
