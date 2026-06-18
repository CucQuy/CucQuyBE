import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser, UserRole } from '../../auth/user.types';
import { diffOrders } from './order-history-diff';
import { OrderProc } from './orders.proc';
import {
  Order,
  OrderDeleteResult,
  OrderFieldChange,
  OrderUpdateResult,
} from './orders.types';

/** Ném khi CTV cố cập nhật đơn không phải do họ tạo. Giữ trùng giá trị FE. */
export const ORDER_EDIT_DENIED = 'ORDER_EDIT_DENIED';

/**
 * Toàn bộ logic data ở stored function app.order_* — service chỉ orchestration + map.
 * Mọi call DB qua OrderProc (tầng proc). Đã port mọi side-effect của bản Firestore
 * xuống DB (transaction trong proc):
 *   - Sinh order_number (app.order_next_number).
 *   - Ghi orders + bảng con order_items / order_decorations / order_gift_items /
 *     order_applied_promotions / order_history(+changes).
 *   - Tính giảm giá THẨM QUYỀN (app.promotion_compute) + redeem/release lượt dùng.
 *   - Customer object <-> cột phẳng; createdBy resolve sang display name.
 *
 * Diff history vẫn tính ở TS (port diffOrders) rồi truyền xuống app.order_update.
 * KHÔNG gửi Zalo ở BE — trả changes/prevOrder để FE tự gửi (giữ như bản cũ).
 */
@Injectable()
export class OrdersService {
  constructor(private readonly proc: OrderProc) {}

  // ── Đọc: danh sách đơn (đã enrich createdBy = tên hiển thị, sort number desc) ──
  async fetchOrders(): Promise<Order[]> {
    return this.proc.list();
  }

  // ── Sinh số đơn kế tiếp ─────────────────────────────────────
  async getNextOrderNumber(): Promise<string> {
    return (await this.proc.nextNumber()) ?? 'ORD-000001';
  }

  // ── Tạo đơn — proc tự tính promo/total + redeem + ghi bảng con ──
  async addOrder(
    orderData: Record<string, any>,
    _currentUser: AuthUser,
  ): Promise<Order> {
    return this.proc.create(orderData);
  }

  // ── Cập nhật đơn (check quyền CTV + ghi history qua diff) ────
  async updateOrder(
    orderId: string,
    orderData: Record<string, any>,
    currentUser: AuthUser,
  ): Promise<OrderUpdateResult> {
    // Lấy đơn hiện tại để (a) check tồn tại/quyền, (b) tính diff history.
    const existing = await this.proc.get(orderId);
    if (!existing) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }

    // CTV chỉ được sửa đơn của chính mình (giữ chữ ký lỗi FE).
    if (currentUser?.role === UserRole.COLABORATOR) {
      const creatorUid = existing.createdByUid;
      if (!currentUser.uid || !creatorUid || creatorUid !== currentUser.uid) {
        throw new ForbiddenException(ORDER_EDIT_DENIED);
      }
    }

    // Diff history: so existing (đã có) với payload mới (port diffOrders TS).
    const c = orderData.customer || {};
    const safeCustomer = {
      id: c.id || '',
      name: c.name || '',
      phone: c.phone || '',
      address: c.address || '',
      email: c.email || '',
      city: c.city || '',
      country: c.country || '',
    };
    const changes: OrderFieldChange[] = diffOrders(existing, {
      ...existing,
      ...orderData,
      customer: safeCustomer,
    });

    const userJson = {
      uid: currentUser?.uid ?? '',
      role: currentUser?.role ?? '',
      displayName: currentUser?.displayName ?? '',
      email: currentUser?.email ?? '',
    };

    const result = await this.proc.update(orderId, orderData, userJson, changes);

    // Proc trả { order, changes, prevOrder } — flatten về OrderUpdateResult.
    const r = result as unknown as {
      order: Order;
      changes: OrderFieldChange[];
      prevOrder: Order;
    };
    return { ...r.order, changes: r.changes, prevOrder: r.prevOrder };
  }

  /** Xoá đơn — proc trả snapshot đã xoá + hoàn lượt KM. */
  async deleteOrder(id: string): Promise<OrderDeleteResult> {
    return this.proc.delete(id);
  }
}
