import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Hàng (snake_case) trả ra từ stored function. */
export type SurchargeTagRow = {
  key: string;
  label: string;
  preset: number | null;
  active: boolean | null;
  sort_order: number | null;
};

const COLS = `key, label, preset, active, sort_order`;

/**
 * Tầng quản lý stored procedure của domain surcharge_tags.
 * Chỉ ở đây mới gọi DB — service import class này để dùng.
 */
@Injectable()
export class SurchargeTagProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<SurchargeTagRow[]> {
    return this.db.sql<SurchargeTagRow[]>`SELECT ${this.db.sql.unsafe(COLS)} FROM surcharge_tag_list()`;
  }

  saveAll(items: unknown): Promise<SurchargeTagRow[]> {
    return this.db.sql<SurchargeTagRow[]>`
      SELECT ${this.db.sql.unsafe(COLS)}
      FROM surcharge_tag_save_all(${this.db.json(items ?? [])}::jsonb)`;
  }
}
