import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  Order,
  OrderDeleteResult,
  OrderFieldChange,
  OrderUpdateResult,
  RefundListItem,
} from './orders.types';

/**
 * Tầng quản lý stored procedure của domain orders.
 * Chỉ ở đây mới gọi order_* — service import class này để dùng.
 * Trả raw rows/jsonb; map/orchestration nằm ở service.
 */
@Injectable()
export class OrderProc {
  constructor(private readonly db: DbService) {}

  // ── Đọc: danh sách đơn (đã enrich createdBy = tên hiển thị, sort number desc) ──
  async list(): Promise<Order[]> {
    const [row] = await this.db.sql<{ list: Order[] }[]>`
      SELECT order_list() AS list`;
    return row?.list ?? [];
  }

  // ── Đọc: 1 đơn theo id ──────────────────────────────────────
  async get(id: string): Promise<Order | null> {
    const [row] = await this.db.sql<{ order: Order | null }[]>`
      SELECT order_get(${id}) AS "order"`;
    return row?.order ?? null;
  }

  // ── Sinh số đơn kế tiếp ─────────────────────────────────────
  async nextNumber(): Promise<string | undefined> {
    const [row] = await this.db.sql<{ n: string }[]>`
      SELECT order_next_number() AS n`;
    return row?.n;
  }

  // ── Tạo đơn — proc tự tính promo/total + redeem + ghi bảng con ──
  async create(orderData: Record<string, any>): Promise<Order> {
    const [row] = await this.db.sql<{ order: Order }[]>`
      SELECT order_create(${this.db.json(orderData)}::jsonb) AS "order"`;
    return row.order;
  }

  // ── Cập nhật đơn (diff history tính ở TS rồi truyền xuống) ───
  async update(
    orderId: string,
    orderData: Record<string, any>,
    userJson: Record<string, any>,
    changes: OrderFieldChange[],
  ): Promise<OrderUpdateResult> {
    const [row] = await this.db.sql<{ result: OrderUpdateResult }[]>`
      SELECT order_update(
        ${orderId},
        ${this.db.json(orderData)}::jsonb,
        ${this.db.json(userJson)}::jsonb,
        ${this.db.json(changes)}::jsonb
      ) AS result`;
    return row.result;
  }

  // ── Xoá đơn — proc trả snapshot đã xoá + hoàn lượt KM ───────
  async delete(id: string): Promise<OrderDeleteResult> {
    const [row] = await this.db.sql<{ result: OrderDeleteResult }[]>`
      SELECT order_delete(${id}) AS result`;
    return row.result;
  }

  // ── Đọc: TOÀN BỘ phiếu hoàn (mọi đơn) + ngữ cảnh đơn — đối soát từ phía GD tiền ra ──
  async refundList(): Promise<RefundListItem[]> {
    const [row] = await this.db.sql<{ list: RefundListItem[] }[]>`
      SELECT refund_list_all() AS list`;
    return row?.list ?? [];
  }

  // ── Đối soát phiếu hoàn ↔ giao dịch SePay 'out' — trả order đầy đủ ──
  async reconcileRefund(
    refundId: string,
    transactionId: string,
    userJson: Record<string, any>,
  ): Promise<Order> {
    const [row] = await this.db.sql<{ order: Order }[]>`
      SELECT order_refund_reconcile(
        ${refundId},
        ${transactionId},
        ${this.db.json(userJson)}::jsonb
      ) AS "order"`;
    return row.order;
  }

  // ── Đánh dấu phiếu hoàn trả tiền mặt (gỡ giao dịch) — trả order ──
  async markRefundCash(
    refundId: string,
    userJson: Record<string, any>,
  ): Promise<Order> {
    const [row] = await this.db.sql<{ order: Order }[]>`
      SELECT order_refund_mark_cash(
        ${refundId},
        ${this.db.json(userJson)}::jsonb
      ) AS "order"`;
    return row.order;
  }

  // ── Gỡ đối soát phiếu hoàn (về chưa đối soát) — trả order ──
  async unreconcileRefund(
    refundId: string,
    userJson: Record<string, any>,
  ): Promise<Order> {
    const [row] = await this.db.sql<{ order: Order }[]>`
      SELECT order_refund_unreconcile(
        ${refundId},
        ${this.db.json(userJson)}::jsonb
      ) AS "order"`;
    return row.order;
  }
}
