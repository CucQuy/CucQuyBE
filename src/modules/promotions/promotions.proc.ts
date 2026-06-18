import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  AppliedPromotion,
  ComputeInput,
  ComputeResult,
  Promotion,
} from './promotions.types';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';

/**
 * Tầng quản lý stored procedure của domain promotions.
 * Chỉ ở đây mới gọi promotion_* — service import class này để dùng.
 * Trả raw rows/jsonb; map/orchestration để ở service.
 */
@Injectable()
export class PromotionProc {
  constructor(private readonly db: DbService) {}

  // ───────────────────────── CRUD ─────────────────────────

  list(): Promise<{ list: Promotion[] }[]> {
    return this.db.sql<{ list: Promotion[] }[]>`
      SELECT promotion_list() AS list`;
  }

  create(dto: CreatePromotionDto): Promise<{ result: { id: string } }[]> {
    return this.db.sql<{ result: { id: string } }[]>`
      SELECT promotion_create(${this.db.json(dto)}::jsonb) AS result`;
  }

  update(id: string, dto: UpdatePromotionDto): Promise<unknown> {
    return this.db.sql`
      SELECT promotion_update(${id}, ${this.db.json(dto)}::jsonb)`;
  }

  delete(id: string): Promise<unknown> {
    return this.db.sql`SELECT promotion_delete(${id})`;
  }

  // ─────────────────── Engine tính giảm giá ───────────────────

  compute(input: ComputeInput): Promise<{ result: ComputeResult }[]> {
    return this.db.sql<{ result: ComputeResult }[]>`
      SELECT promotion_compute(${this.db.json(input)}::jsonb) AS result`;
  }

  // ─────────────────── Lượt dùng (redeem / release) ───────────────────

  redeem(applied: AppliedPromotion[]): Promise<unknown> {
    return this.db.sql`
      SELECT promotion_redeem(${this.db.json(applied ?? [])}::jsonb)`;
  }

  release(applied: AppliedPromotion[]): Promise<unknown> {
    return this.db.sql`
      SELECT promotion_release(${this.db.json(applied ?? [])}::jsonb)`;
  }
}
