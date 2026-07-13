import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

export type AssetRow = {
  id: string;
  name: string;
  cost: string | number | null;
  useful_months: number | null;
  start_date: string | Date | null;
  category: string | null;
  note: string | null;
  created_at: string | Date | null;
};

@Injectable()
export class AssetProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<AssetRow[]> {
    return this.db.sql<AssetRow[]>`SELECT * FROM asset_list()`;
  }

  upsert(body: unknown): Promise<AssetRow[]> {
    return this.db.sql<AssetRow[]>`SELECT * FROM asset_upsert(${this.db.json(body ?? {})}::jsonb)`;
  }

  remove(id: string): Promise<unknown> {
    return this.db.sql`SELECT asset_delete(${id})`;
  }
}
