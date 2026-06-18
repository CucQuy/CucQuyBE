import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Dòng thô từ commission_group_*: cột snake_case + tiers jsonb. */
export type CommissionGroupRow = {
  id: string;
  name: string | null;
  min_margin: string | number | null;
  max_margin: string | number | null;
  profit_share_rate: string | number | null;
  fallback_rate: string | number | null;
  sort_order: number | null;
  tiers: unknown;
};

/**
 * Tầng quản lý stored procedure của domain commission-groups.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class CommissionGroupProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<CommissionGroupRow[]> {
    return this.db.sql<CommissionGroupRow[]>`SELECT * FROM commission_group_list()`;
  }

  create(data: Record<string, unknown>): Promise<CommissionGroupRow[]> {
    return this.db.sql<CommissionGroupRow[]>`
      SELECT * FROM commission_group_create(${this.db.json(data ?? {})}::jsonb)`;
  }

  update(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.db.sql`
      SELECT FROM commission_group_update(${id}, ${this.db.json(data ?? {})}::jsonb)`;
  }

  delete(id: string): Promise<unknown> {
    return this.db.sql`SELECT commission_group_delete(${id})`;
  }
}
