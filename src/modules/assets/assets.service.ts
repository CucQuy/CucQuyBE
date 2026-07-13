import { Injectable } from '@nestjs/common';
import { AssetProc, AssetRow } from './assets.proc';
import { Asset } from './assets.types';

const toDate = (v: string | Date | null): string => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const mapRow = (r: AssetRow): Asset => ({
  id: r.id,
  name: r.name ?? '',
  cost: Number(r.cost) || 0,
  usefulMonths: Number(r.useful_months) || 1,
  startDate: toDate(r.start_date),
  category: r.category ?? null,
  note: r.note ?? null,
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ''),
});

@Injectable()
export class AssetsService {
  constructor(private readonly proc: AssetProc) {}

  async list(): Promise<Asset[]> {
    return (await this.proc.list()).map(mapRow);
  }

  async upsert(body: unknown): Promise<Asset> {
    const rows = await this.proc.upsert(body);
    return mapRow(rows[0]);
  }

  async remove(id: string): Promise<void> {
    await this.proc.remove(id);
  }
}
