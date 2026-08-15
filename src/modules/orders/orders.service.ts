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
import { EventsGateway } from '../events/events.gateway';
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
    private readonly events: EventsGateway,
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
    // Đơn ăn tại chỗ (có bàn) → báo mọi máy admin refetch danh sách bàn (realtime).
    if (order.tableId) this.events.emitTablesChanged({ reason: 'open' });
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
  /** Danh sách đơn PHÂN TRANG + lọc + sắp (server-side) — cho trang Orders. */
  async listOrdersPage(params: Record<string, any>): Promise<{ items: Order[]; total: number }> {
    return this.proc.listPage(params ?? {});
  }

  /** Đếm nhanh (total/pending/cancelled/unpaid) cho OrdersStats. */
  async orderCounts(): Promise<Record<string, number>> {
    return this.proc.counts();
  }

  /** 1 đơn đầy đủ theo id (order_get) — cho màn chi tiết/sửa (list trả bản nhẹ). */
  async getOrder(id: string): Promise<Order> {
    const order = await this.proc.get(id);
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
    return order;
  }

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

    // Đơn ăn tại chỗ (bàn cũ hoặc mới) → báo mọi máy admin refetch danh sách bàn.
    if (r.order.tableId || existing.tableId) {
      this.events.emitTablesChanged({ reason: 'update' });
    }

    return { ...r.order, changes: r.changes, prevOrder: r.prevOrder };
  }

  /**
   * Đổi TRẠNG THÁI đơn (NHẸ) — chỉ UPDATE status + 1 history (order_update_status),
   * KHÔNG tính lại KM / DELETE-INSERT items như updateOrder full. Trả cùng shape
   * ({...order, changes, prevOrder}) để FE gửi Zalo giữ nguyên.
   */
  async updateOrderStatus(
    orderId: string,
    status: string,
    currentUser: AuthUser,
  ): Promise<OrderUpdateResult> {
    const existing = await this.proc.get(orderId);
    if (!existing) throw new NotFoundException('ORDER_NOT_FOUND');

    if (currentUser?.role === UserRole.COLABORATOR) {
      const creatorUid = existing.createdByUid;
      if (!currentUser.uid || !creatorUid || creatorUid !== currentUser.uid) {
        throw new ForbiddenException(ORDER_EDIT_DENIED);
      }
    }

    // Không đổi → trả nguyên trạng, không ghi history / noti.
    if ((existing.status ?? '') === (status ?? '')) {
      return { ...existing, changes: [], prevOrder: existing } as OrderUpdateResult;
    }

    const userJson = {
      uid: currentUser?.uid ?? '',
      role: currentUser?.role ?? '',
      displayName: currentUser?.displayName ?? '',
      email: currentUser?.email ?? '',
    };
    const updated = await this.proc.updateStatus(orderId, status, userJson);
    const changes: OrderFieldChange[] = [
      { field: 'status', label: 'Trạng thái', oldValue: existing.status ?? '—', newValue: status },
    ];

    void this.notif.log({
      kind: 'inapp',
      category: 'order_status',
      title: `Cập nhật đơn ${updated.orderNumber ?? orderId} · ${this.who(currentUser)}`,
      body: `Trạng thái → ${status}`,
      target: 'admins',
      triggeredBy: currentUser?.uid,
    });

    return { ...updated, changes, prevOrder: existing } as OrderUpdateResult;
  }

  /**
   * Đánh dấu đơn ĐÃ IN BILL (bill_printed_at = now()). Nhẹ: không ghi history / noti,
   * không tính lại gì. Ai xem được đơn thì in được (không giới hạn CTV như sửa đơn).
   * Trả order đầy đủ đã cập nhật (có billPrintedAt) để FE cập nhật badge.
   */
  async markBillPrinted(orderId: string, currentUser: AuthUser): Promise<Order> {
    const existing = await this.proc.get(orderId);
    if (!existing) throw new NotFoundException('ORDER_NOT_FOUND');
    const userJson = {
      uid: currentUser?.uid ?? '',
      role: currentUser?.role ?? '',
      displayName: currentUser?.displayName ?? '',
      email: currentUser?.email ?? '',
    };
    return this.proc.markBillPrinted(orderId, userJson);
  }

  /**
   * Patch NHẸ các field nhanh (paymentStatus/paymentMethod/deliveryType) — dùng
   * order_patch_fields (chỉ đụng field gửi lên, không tính lại KM/items). Trả cùng
   * shape {...order, changes, prevOrder}. CTV check nằm trong SQL (raise ORDER_EDIT_DENIED).
   */
  async patchOrderFields(
    orderId: string,
    patch: Record<string, any>,
    currentUser: AuthUser,
  ): Promise<OrderUpdateResult> {
    const userJson = {
      uid: currentUser?.uid ?? '',
      role: currentUser?.role ?? '',
      displayName: currentUser?.displayName ?? '',
      email: currentUser?.email ?? '',
    };
    const result = await this.proc.patchFields(orderId, patch, userJson);
    const r = result as unknown as {
      order: Order;
      changes: OrderFieldChange[];
      prevOrder: Order;
    };
    const chg = r.changes ?? [];
    if (chg.length > 0) {
      void this.notif.log({
        kind: 'inapp',
        category: 'order_update',
        title: `Cập nhật đơn ${r.order.orderNumber ?? orderId} · ${this.who(currentUser)}`,
        body: chg.map((x) => `${x.label ?? x.field} → ${x.newValue}`).join(' · '),
        target: 'admins',
        triggeredBy: currentUser?.uid,
      });
    }
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

  /** Tạo phiếu hoàn TAY theo hạng mục cho 1 đơn (tuỳ chọn gắn luôn GD tiền ra). */
  async createRefund(
    orderId: string,
    dto: { amount: number; category?: string; reason?: string; transactionId?: string },
    currentUser: AuthUser,
  ): Promise<Order> {
    try {
      return await this.proc.createRefund(
        orderId,
        dto.amount,
        dto.category ?? null,
        dto.reason ?? null,
        dto.transactionId ?? null,
        userJson(currentUser),
      );
    } catch (e) {
      throw mapRefundError(e);
    }
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

  /** Đồng bộ tiền thu hộ (COD) từ file ví SPX. apply=false → preview; true → tạo GD + cộng paid_amount. */
  async syncCod(
    rows: Record<string, any>[],
    apply: boolean,
  ): Promise<any> {
    return this.proc.syncCod(Array.isArray(rows) ? rows : [], !!apply);
  }

  /** Tra cứu LIVE hành trình vận đơn từ 3PL (hiện hỗ trợ SPX). Proxy để tránh CORS. */
  async fetchTracking(tn: string): Promise<{
    tn: string;
    status: string | null;
    events: { time: number; label: string; location?: string }[];
    deliveredAt: number | null;
    shippedAt: number | null;
  }> {
    const clean = (tn || '').trim();
    const empty = { tn: clean, status: null, events: [] as any[], deliveredAt: null, shippedAt: null };
    if (!/^SPXVN/i.test(clean)) return empty; // chỉ SPX (mở rộng 3PL khác sau)
    try {
      const url = `https://spx.vn/shipment/order/open/order/get_order_info?spx_tn=${encodeURIComponent(clean)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j: any = await res.json();
      const data = j?.data ?? {};
      const group: string | null = data?.order_info?.tracking_code_group_name ?? null;
      const recs: any[] = data?.sls_tracking_info?.records ?? [];
      // Mốc giao thành công = code F980 (actual_time, unix giây).
      const del = recs.find(
        (r) => (r?.tracking_code || '').toString().trim().toUpperCase() === 'F980' && r?.actual_time,
      );
      const deliveredAt = del ? Number(del.actual_time) || null : null;
      // Mốc BẮT ĐẦU tính thời gian giao = lúc ĐVVC LẤY HÀNG (F100 "Pickup From Seller"),
      // KHÔNG phải lúc người gửi tạo đơn/chuẩn bị (F000 "Manifested" = mốc sớm nhất).
      const codeOf = (r: any) => (r?.tracking_code || '').toString().trim().toUpperCase();
      const pickup = recs.find((r) => codeOf(r) === 'F100' && r?.actual_time);
      let shippedAt: number | null = pickup ? Number(pickup.actual_time) || null : null;
      if (!shippedAt) {
        // Thiếu mốc F100 → mốc scan sớm nhất KHÁC F000 (đã vào mạng lưới ĐVVC).
        const inNetwork = recs
          .filter((r) => codeOf(r) !== 'F000' && Number(r?.actual_time) > 0)
          .map((r) => Number(r.actual_time));
        shippedAt = inNetwork.length ? Math.min(...inNetwork) : null;
      }
      const events = recs
        // chỉ mốc SPX hiển thị (display_flag=1); bỏ mốc phụ ẩn (packed/loaded…)
        .filter((r) => r?.actual_time && Number(r.display_flag) === 1)
        .map((r) => ({
          time: Number(r.actual_time) || 0,
          label: mapSpxLabel(r.tracking_code, r.tracking_name, r.buyer_description || r.description),
          location: r?.current_location?.location_name || undefined,
        }));
      return { tn: clean, status: SPX_GROUP_VI[group ?? ''] ?? group, events, deliveredAt, shippedAt };
    } catch {
      return empty;
    }
  }

  /** Refresh trạng thái VĐ (mốc mới nhất) cho các đơn SPX đang chạy → lưu vào DB. */
  async refreshTracking(): Promise<{ updated: number; total: number }> {
    const rows = await this.proc.trackedForRefresh();
    let updated = 0;
    const batchSize = 6;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (r) => {
          const t = await this.fetchTracking(r.tracking_number);
          const e0 = t.events?.[0];
          // Đơn HUỶ/HOÀN không sinh mốc sự kiện display_flag → e0 vẫn là mốc cũ ("Chuẩn bị
          // hàng"). Ưu tiên nhóm trạng thái (t.status = 'Đã huỷ'/'Hoàn hàng') để không kẹt.
          const terminal = t.status === 'Đã huỷ' || t.status === 'Hoàn hàng';
          const latest = terminal
            ? t.status
            : e0
              ? e0.label + (e0.location ? ` · ${e0.location}` : '')
              : t.status ?? null;
          if (latest) {
            await this.proc.setTrackingStatus(r.id, latest, t.deliveredAt, t.shippedAt);
            updated++;
          }
        }),
      );
    }
    return { updated, total: rows.length };
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

/** Bảng dịch theo MÃ MỐC ổn định của SPX (tracking_code) — không phụ thuộc chuỗi tên EN. */
const SPX_CODE_VI: Record<string, string> = {
  F000: 'Người gửi đang chuẩn bị hàng',   // Manifested
  F100: 'ĐVVC đã lấy hàng',                // Pickup From Seller
  F440: 'Đã đến bưu cục',                  // Enter First Mile Hub
  F450: 'Đã rời bưu cục',                  // Left First Mile Hub
  F510: 'Đã đến kho phân loại',            // Enter Sorting Center
  F540: 'Đã rời kho phân loại',            // Left Sorting Center
  F599: 'Đã đến bưu cục giao',             // Enter Last Mile Hub
  F600: 'Đang giao hàng',                  // Out For Delivery
  F980: 'Đã giao thành công',              // Delivered
};

/**
 * Nhãn mốc → tiếng Việt: ưu tiên MÃ SPX (bền); mã lạ → thử từ khoá tên; cuối cùng mô tả gốc.
 */
function mapSpxLabel(code: string | undefined, name: string | undefined, fallback: string | undefined): string {
  const byCode = SPX_CODE_VI[(code || '').trim().toUpperCase()];
  if (byCode) return byCode;
  const n = (name || '').trim().toLowerCase();
  const has = (...ks: string[]) => ks.every((k) => n.includes(k));
  if (has('out for delivery')) return 'Đang giao hàng';
  if (has('delivered')) return 'Đã giao thành công';
  if (has('fail')) return 'Giao không thành công';
  if (has('return')) return 'Hoàn hàng';
  if (has('last mile hub', 'enter')) return 'Đã đến bưu cục giao';
  if (has('last mile hub', 'left')) return 'Đã rời bưu cục giao';
  if (has('sorting cent', 'enter')) return 'Đã đến kho phân loại';
  if (has('sorting cent', 'left')) return 'Đã rời kho phân loại';
  if (has('first mile hub', 'enter')) return 'Đã đến bưu cục';
  if (has('first mile hub', 'left')) return 'Đã rời bưu cục';
  if (has('pickup')) return 'ĐVVC đã lấy hàng';
  if (has('manifest')) return 'Người gửi đang chuẩn bị hàng';
  return fallback || name || 'Cập nhật';
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
  if (
    msg.includes('REFUND_NOT_FOUND') ||
    msg.includes('TRANSACTION_NOT_FOUND') ||
    msg.includes('ORDER_NOT_FOUND')
  ) {
    return new NotFoundException(
      msg.includes('TRANSACTION')
        ? 'TRANSACTION_NOT_FOUND'
        : msg.includes('ORDER')
          ? 'ORDER_NOT_FOUND'
          : 'REFUND_NOT_FOUND',
    );
  }
  if (msg.includes('ORDER_REFUND_AMOUNT_INVALID')) {
    return new BadRequestException('ORDER_REFUND_AMOUNT_INVALID');
  }
  if (msg.includes('TRANSACTION_ALREADY_LINKED')) {
    return new ConflictException('TRANSACTION_ALREADY_LINKED');
  }
  if (msg.includes('TRANSACTION_NOT_OUTGOING')) {
    return new BadRequestException('TRANSACTION_NOT_OUTGOING');
  }
  return e as Error;
}
