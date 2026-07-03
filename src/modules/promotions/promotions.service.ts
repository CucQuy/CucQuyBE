import { Injectable } from '@nestjs/common';
import { PromotionProc } from './promotions.proc';
import {
  AppliedPromotion,
  ComputeInput,
  ComputeResult,
  Promotion,
} from './promotions.types';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';

/**
 * Toàn bộ logic ở stored function app.promotion_* — service chỉ orchestration + map.
 * Mọi call DB qua PromotionProc.
 * CRUD đồng bộ promotion_products / promotion_categories ở DB.
 * Engine tính giảm giá (BUY_X_GET_Y, scope, FREE_SHIP, PERCENT/FIXED),
 * redeem / release lượt dùng đều nằm trong DB.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly proc: PromotionProc) {}

  // ───────────────────────── CRUD ─────────────────────────

  async findAll(): Promise<Promotion[]> {
    const [row] = await this.proc.list();
    return row?.list ?? [];
  }

  async create(dto: CreatePromotionDto): Promise<{ id: string }> {
    const [row] = await this.proc.create(dto);
    return row.result;
  }

  async update(id: string, dto: UpdatePromotionDto): Promise<void> {
    await this.proc.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.proc.delete(id);
  }

  /** Mở lại chạy đợt mới: cất đợt hiện tại vào lịch sử, reset lượt, đặt kỳ mới. */
  async reopen(id: string, input: { startAt?: string; endAt?: string }): Promise<void> {
    await this.proc.reopen(id, input);
  }

  // ─────────────────── Engine tính giảm giá ───────────────────

  /** Tính giảm giá thẩm quyền cho 1 giỏ hàng (dùng cho /preview và lúc tạo đơn). */
  async computeForCart(input: ComputeInput): Promise<ComputeResult> {
    const [row] = await this.proc.compute(input);
    return row.result;
  }

  // ─────────────────── Lượt dùng (redeem / release) ───────────────────

  /** Tăng usedCount cho các promo đã áp (atomic, chặn vượt maxUses). Gọi khi tạo đơn. */
  async redeem(applied: AppliedPromotion[]): Promise<void> {
    await this.proc.redeem(applied);
  }

  /** Hoàn lại lượt khi huỷ/gỡ khuyến mãi khỏi đơn. */
  async release(applied: AppliedPromotion[]): Promise<void> {
    await this.proc.release(applied);
  }
}
