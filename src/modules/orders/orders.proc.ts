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

  // ── Danh sách PHÂN TRANG + lọc + sắp (server-side) ──────────
  async listPage(params: Record<string, any>): Promise<{ items: Order[]; total: number }> {
    const [row] = await this.db.sql<{ result: { items: Order[]; total: number } }[]>`
      SELECT order_list_page(${this.db.json(params ?? {})}::jsonb) AS result`;
    return row?.result ?? { items: [], total: 0 };
  }

  // ── Đếm nhanh cho OrdersStats ───────────────────────────────
  async counts(): Promise<Record<string, number>> {
    const [row] = await this.db.sql<{ result: Record<string, number> }[]>`
      SELECT order_counts() AS result`;
    return row?.result ?? { total: 0, pending: 0, cancelled: 0, unpaid: 0 };
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

  // ── Đổi TRẠNG THÁI đơn (nhẹ): chỉ UPDATE status + 1 history, không tính lại KM/items ──
  async updateStatus(
    id: string,
    status: string,
    userJson: Record<string, any>,
  ): Promise<Order> {
    const [row] = await this.db.sql<{ order: Order }[]>`
      SELECT order_update_status(${id}, ${status}, ${this.db.json(userJson)}::jsonb) AS "order"`;
    return row.order;
  }

  // ── Đánh dấu đã in bill cho khách (set bill_printed_at = now()) ──
  async markBillPrinted(
    id: string,
    userJson: Record<string, any>,
  ): Promise<Order> {
    const [row] = await this.db.sql<{ order: Order }[]>`
      SELECT order_mark_bill_printed(${id}, ${this.db.json(userJson)}::jsonb) AS "order"`;
    return row.order;
  }

  // ── Patch field NHẸ (paymentStatus/paymentMethod/deliveryType) — không tính lại KM/items ──
  async patchFields(
    id: string,
    patch: Record<string, any>,
    userJson: Record<string, any>,
  ): Promise<OrderUpdateResult> {
    const [row] = await this.db.sql<{ result: OrderUpdateResult }[]>`
      SELECT order_patch_fields(
        ${id}, ${this.db.json(patch)}::jsonb, ${this.db.json(userJson)}::jsonb
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

  // ── Tạo phiếu hoàn TAY theo hạng mục (tuỳ chọn gắn luôn GD tiền ra) — trả order ──
  async createRefund(
    orderId: string,
    amount: number,
    category: string | null,
    reason: string | null,
    transactionId: string | null,
    userJson: Record<string, any>,
  ): Promise<Order> {
    const [row] = await this.db.sql<{ order: Order }[]>`
      SELECT order_refund_create(
        ${orderId},
        ${amount},
        ${category},
        ${reason},
        ${transactionId},
        ${this.db.json(userJson)}::jsonb
      ) AS "order"`;
    return row.order;
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

  // ── Đối soát TAY 1 giao dịch (in/out) với đơn: +/- paid_amount, derive status,
  //    gắn order_number cho GD. Trả order đã cập nhật (idempotent nếu GD đã gắn). ──
  async reconcileTransaction(
    orderId: string,
    transactionId: string,
  ): Promise<Order> {
    const [row] = await this.db.sql<{ order: Order }[]>`
      SELECT order_reconcile_transaction(
        ${orderId},
        ${transactionId}
      ) AS "order"`;
    return row.order;
  }

  // ── Đồng bộ vận đơn từ file 3PL: match theo SĐT, preview (apply=false) / ghi (apply=true) ──
  async syncTracking(
    rows: Record<string, any>[],
    apply: boolean,
  ): Promise<any> {
    const [row] = await this.db.sql<{ result: any }[]>`
      SELECT order_sync_tracking(${this.db.json(rows)}::jsonb, ${apply}) AS result`;
    return row.result;
  }

  // ── Đồng bộ tiền thu hộ (COD) từ file ví SPX: match theo tracking_number ──
  async syncCod(rows: Record<string, any>[], apply: boolean): Promise<any> {
    const [row] = await this.db.sql<{ result: any }[]>`
      SELECT order_sync_cod(${this.db.json(rows)}::jsonb, ${apply}) AS result`;
    return row.result;
  }

  // ── Đơn SPX đang chạy (chưa giao/huỷ) để refresh trạng thái VĐ ──
  // Bao gồm CẢ đơn đã giao nhưng CHƯA có delivered_at (backfill mốc giao 1 lần).
  async trackedForRefresh(): Promise<{ id: string; tracking_number: string }[]> {
    return this.db.sql<{ id: string; tracking_number: string }[]>`
      SELECT id, tracking_number FROM orders
      WHERE tracking_number ILIKE 'SPXVN%'
        AND COALESCE(status, '') <> 'CANCELLED'
        AND (COALESCE(tracking_status, '') NOT ILIKE '%đã giao%' OR delivered_at IS NULL OR shipped_at IS NULL)
      ORDER BY created_at DESC NULLS LAST
      LIMIT 100`;
  }

  /** Cập nhật trạng thái VĐ; lưu mốc giao (delivered_at) + mốc bắt đầu VC (shipped_at), không ghi đè. */
  async setTrackingStatus(
    id: string,
    status: string | null,
    deliveredAtSec?: number | null,
    shippedAtSec?: number | null,
  ): Promise<void> {
    const del = deliveredAtSec && deliveredAtSec > 0 ? deliveredAtSec : null;
    const ship = shippedAtSec && shippedAtSec > 0 ? shippedAtSec : null;
    await this.db.sql`
      UPDATE orders
         SET tracking_status = ${status},
             delivered_at = COALESCE(delivered_at, CASE WHEN ${del}::bigint IS NULL THEN NULL ELSE to_timestamp(${del}) END),
             -- shipped_at = mốc ĐVVC lấy hàng (F100). Ưu tiên giá trị mới để re-sync sửa
             -- được mốc cũ (F000) đã lưu; giữ giá trị cũ nếu lần này chưa có mốc.
             shipped_at = COALESCE(CASE WHEN ${ship}::bigint IS NULL THEN NULL ELSE to_timestamp(${ship}) END, shipped_at),
             updated_at = now()
       WHERE id = ${id}`;
  }

  // ── Làm mịn địa chỉ SPX ──────────────────────────────────────
  /** Đọc thông tin cần để resolve/quyết định resolve lại 1 đơn. */
  async getAddressForResolve(id: string): Promise<{
    address: string;
    city: string;
    deliveryType: string;
    trackingNumber: string | null;
    spxSource: string | null;
    spxManual: boolean;
  } | null> {
    const [row] = await this.db.sql<
      {
        address: string | null;
        city: string | null;
        delivery_type: string | null;
        tracking_number: string | null;
        spx_source: string | null;
        spx_manual: boolean | null;
      }[]
    >`
      SELECT address, customer_city AS city, delivery_type, tracking_number,
             spx_source, spx_manual
        FROM orders WHERE id = ${id}`;
    if (!row) return null;
    return {
      address: row.address ?? '',
      city: row.city ?? '',
      deliveryType: row.delivery_type ?? '',
      trackingNumber: row.tracking_number,
      spxSource: row.spx_source,
      spxManual: Boolean(row.spx_manual),
    };
  }

  /** Lưu địa chỉ SPX đã làm mịn (auto lẫn sửa tay). Trả order sau cập nhật. */
  async setSpxAddress(
    id: string,
    state: string,
    city: string,
    ward: string,
    detail: string,
    source: string,
    manual: boolean,
  ): Promise<Order | null> {
    const [row] = await this.db.sql<{ order: Order | null }[]>`
      SELECT order_set_spx_address(
        ${id}, ${state}, ${city}, ${ward}, ${detail}, ${source}, ${manual}
      ) AS "order"`;
    return row?.order ?? null;
  }
}
