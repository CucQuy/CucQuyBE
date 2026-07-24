import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser, UserRole } from '../../auth/user.types';
import { diffOrders } from './order-history-diff';
import { OrderProc } from './orders.proc';
import { NotificationsService } from '../notifications/notifications.service';
import {
  Order,
  OrderDeleteResult,
  OrderFieldChange,
  OrderUpdateResult,
  RefundListItem,
} from './orders.types';

/** Ném khi CTV cố cập nhật đơn không phải do họ tạo. Giữ trùng giá trị FE. */
export const ORDER_EDIT_DENIED = 'ORDER_EDIT_DENIED';

/**
 * Toàn bộ logic data ở stored function app.order_* — service chỉ orchestration + map.
 * Mọi call DB qua OrderProc (tầng proc). Đã port mọi side-effect của bản cũ
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
  constructor(
    private readonly proc: OrderProc,
    private readonly notif: NotificationsService,
  ) {}

  /** Tên hiển thị người thao tác cho nội dung thông báo. */
  private who(u?: AuthUser): string {
    return u?.displayName || u?.email || 'ai đó';
  }

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
    const order = await this.proc.create(orderData);
    void this.notif.log({
      kind: 'inapp',
      category: 'order_new',
      title: `Đơn mới ${order.orderNumber ?? order.id}`,
      body: `${order.customerName || order.customer?.name || ''} · ${(order.total ?? 0).toLocaleString('vi-VN')}đ`.trim(),
      target: 'admins',
      triggeredBy: _currentUser?.uid,
    });
    return order;
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

    // Thông báo in-app: phân loại thanh toán / đổi trạng thái / sửa thường.
    const chg = r.changes ?? [];
    const pay = chg.find((x) => x.field === 'paymentStatus');
    const st = chg.find((x) => x.field === 'status');
    const num = r.order.orderNumber ?? orderId;
    let body: string;
    let category: string;
    if (pay) { category = 'order_payment'; body = `Thanh toán → ${pay.newValue}`; }
    else if (st) { category = 'order_status'; body = `Trạng thái → ${st.newValue}`; }
    else { category = 'order_update'; body = chg.length ? `Đã sửa ${chg.length} mục` : 'Cập nhật đơn'; }
    void this.notif.log({
      kind: 'inapp',
      category,
      title: `Cập nhật đơn ${num} · ${this.who(currentUser)}`,
      body,
      target: 'admins',
      triggeredBy: currentUser?.uid,
    });

    return { ...r.order, changes: r.changes, prevOrder: r.prevOrder };
  }

  /** Xoá đơn — proc trả snapshot đã xoá + hoàn lượt KM. */
  async deleteOrder(id: string): Promise<OrderDeleteResult> {
    const res = await this.proc.delete(id);
    void this.notif.log({
      kind: 'inapp',
      category: 'order_delete',
      title: `Xoá đơn ${res.prevOrder?.orderNumber ?? id}`,
      body: res.prevOrder?.customerName || res.prevOrder?.customer?.name || undefined,
      target: 'admins',
    });
    return res;
  }

  /** Danh sách toàn bộ phiếu hoàn (mọi đơn) — đối soát từ phía GD tiền ra. */
  async listRefunds(): Promise<RefundListItem[]> {
    return this.proc.refundList();
  }

  /** Đối soát 1 phiếu hoàn với 1 giao dịch SePay 'out'. Trả order đầy đủ. */
  async reconcileRefund(
    refundId: string,
    transactionId: string,
    currentUser: AuthUser,
  ): Promise<Order> {
    try {
      return await this.proc.reconcileRefund(
        refundId,
        transactionId,
        userJson(currentUser),
      );
    } catch (e) {
      throw mapRefundError(e);
    }
  }

  /** Đánh dấu phiếu hoàn đã trả bằng tiền mặt (gỡ giao dịch). Trả order. */
  async markRefundCash(refundId: string, currentUser: AuthUser): Promise<Order> {
    try {
      return await this.proc.markRefundCash(refundId, userJson(currentUser));
    } catch (e) {
      throw mapRefundError(e);
    }
  }

  /** Gỡ đối soát phiếu hoàn (về chưa đối soát). Trả order. */
  async unreconcileRefund(
    refundId: string,
    currentUser: AuthUser,
  ): Promise<Order> {
    try {
      return await this.proc.unreconcileRefund(refundId, userJson(currentUser));
    } catch (e) {
      throw mapRefundError(e);
    }
  }

  /** Đối soát 1 giao dịch (tiền vào/ra) với đơn ngay từ form: +/- paidAmount + derive
   *  status + gắn order_number cho GD. Trả order đã cập nhật (idempotent). */
  async reconcileTransaction(
    orderId: string,
    transactionId: string,
  ): Promise<Order> {
    try {
      return await this.proc.reconcileTransaction(orderId, transactionId);
    } catch (e) {
      throw mapRefundError(e);
    }
  }

  /** Đồng bộ vận đơn từ file 3PL. apply=false → preview match; true → ghi vào đơn. */
  async syncTracking(
    rows: Record<string, any>[],
    apply: boolean,
  ): Promise<any> {
    return this.proc.syncTracking(Array.isArray(rows) ? rows : [], !!apply);
  }

  /** Tra cứu LIVE hành trình vận đơn từ 3PL (hiện hỗ trợ SPX). Proxy để tránh CORS. */
  async fetchTracking(tn: string): Promise<{
    tn: string;
    status: string | null;
    events: { time: number; label: string; location?: string }[];
  }> {
    const clean = (tn || '').trim();
    const empty = { tn: clean, status: null, events: [] as any[] };
    if (!/^SPXVN/i.test(clean)) return empty; // chỉ SPX (mở rộng 3PL khác sau)
    try {
      const url = `https://spx.vn/shipment/order/open/order/get_order_info?spx_tn=${encodeURIComponent(clean)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j: any = await res.json();
      const data = j?.data ?? {};
      const group: string | null = data?.order_info?.tracking_code_group_name ?? null;
      const recs: any[] = data?.sls_tracking_info?.records ?? [];
      const events = recs
        .filter((r) => r?.actual_time)
        .map((r) => ({
          time: Number(r.actual_time) || 0,
          label: mapSpxLabel(r.tracking_name, r.buyer_description || r.description),
          location: r?.current_location?.location_name || undefined,
        }));
      return { tn: clean, status: SPX_GROUP_VI[group ?? ''] ?? group, events };
    } catch {
      return empty;
    }
  }
}

/** Nhóm trạng thái SPX → tiếng Việt. */
const SPX_GROUP_VI: Record<string, string> = {
  'Pending': 'Chờ lấy hàng',
  'Picked up': 'Đã lấy hàng',
  'In Transit': 'Đang vận chuyển',
  'Out for Delivery': 'Đang giao hàng',
  'Delivered': 'Đã giao',
  'Cancelled': 'Đã huỷ',
  'Returned': 'Hoàn hàng',
};

/** Map tên mốc SPX (EN) → tiếng Việt; không khớp → dùng mô tả gốc. */
const SPX_LABEL_VI: Record<string, string> = {
  'sender is preparing to ship your parcel': 'Người gửi đang chuẩn bị hàng',
  'parcel has been picked up by courier': 'ĐVVC đã lấy hàng',
  'enter domestic first mile hub': 'Đã đến bưu cục',
  'left domestic first mile hub': 'Đã rời bưu cục',
  'enter domestic sorting center': 'Đã đến kho phân loại',
  'left domestic sorting center': 'Đã rời kho phân loại',
  'enter domestic last mile hub': 'Đã đến bưu cục giao',
  'left domestic last mile hub': 'Đã rời bưu cục giao',
  'out for delivery': 'Đang giao hàng',
  'delivered': 'Đã giao thành công',
  'parcel is packed in fm hub and is ready for transit to next station': 'Đã đóng gói tại bưu cục, chờ chuyển tiếp',
  'parcel is loaded into truck, to leave first mile hub soon': 'Đã lên xe, chuẩn bị rời bưu cục',
};

function mapSpxLabel(name: string | undefined, fallback: string | undefined): string {
  const key = (name || '').trim().toLowerCase();
  return SPX_LABEL_VI[key] || fallback || name || 'Cập nhật';
}

/** Chuẩn hoá AuthUser -> jsonb p_user cho stored function. */
function userJson(u: AuthUser): Record<string, any> {
  return {
    uid: u?.uid ?? '',
    role: u?.role ?? '',
    displayName: u?.displayName ?? '',
    email: u?.email ?? '',
  };
}

/** Map exception raw từ Postgres (đối soát) sang HTTP status có nghĩa cho FE. */
function mapRefundError(e: unknown): Error {
  const msg = (e as { message?: string })?.message ?? '';
  if (msg.includes('REFUND_NOT_FOUND') || msg.includes('TRANSACTION_NOT_FOUND')) {
    return new NotFoundException(
      msg.includes('TRANSACTION') ? 'TRANSACTION_NOT_FOUND' : 'REFUND_NOT_FOUND',
    );
  }
  if (msg.includes('TRANSACTION_ALREADY_LINKED')) {
    return new ConflictException('TRANSACTION_ALREADY_LINKED');
  }
  if (msg.includes('TRANSACTION_NOT_OUTGOING')) {
    return new BadRequestException('TRANSACTION_NOT_OUTGOING');
  }
  return e as Error;
}
