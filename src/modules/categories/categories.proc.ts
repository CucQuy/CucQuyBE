import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Hàng (snake_case) trả ra từ stored function. */
export type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number | null;
  description: string | null;
};

const COLS = `id, name, parent_id, icon, color, sort_order, description`;

/**
 * Tầng quản lý stored procedure của domain categories.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class CategoryProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<CategoryRow[]> {
    return this.db.sql<CategoryRow[]>`SELECT ${this.db.sql.unsafe(COLS)} FROM category_list()`;
  }

  saveAll(items: unknown): Promise<CategoryRow[]> {
    return this.db.sql<CategoryRow[]>`
      SELECT ${this.db.sql.unsafe(COLS)}
      FROM category_save_all(${this.db.json(items ?? [])}::jsonb)`;
  }
}
