import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Hàng (snake_case) trả ra từ stored function. */
export type FlavorRow = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number | null;
};

const COLS = `id, name, color, sort_order`;

/** Tầng gọi stored procedure domain flavors. */
@Injectable()
export class FlavorProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<FlavorRow[]> {
    return this.db.sql<FlavorRow[]>`SELECT ${this.db.sql.unsafe(COLS)} FROM flavor_list()`;
  }

  saveAll(items: unknown): Promise<FlavorRow[]> {
    return this.db.sql<FlavorRow[]>`
      SELECT ${this.db.sql.unsafe(COLS)}
      FROM flavor_save_all(${this.db.json(items ?? [])}::jsonb)`;
  }
}
