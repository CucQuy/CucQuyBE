/**
 * Types domain Order — port từ FE (frontend/types/order.ts).
 * Giữ NGUYÊN shape để FE không phải sửa.
 */
import { AppliedPromotion, GiftItem } from '../promotions/promotions.types';

export interface OrderItem {
  id: string;
  productId?: string;
  name: string;
  quantity: number;
  price: number;
  image: string;
  /** Các vị đã chọn khi bán (nếu sản phẩm có vị) */
  flavors?: string[];
}

export interface OrderDecoration {
  materialId: string;
  name: string;
  quantity: number;
  price: number; // đơn giá VND
}

/** Nhãn loại phụ thu tổng theo đơn. */
export type SurchargeTag = 'decoration' | 'theme' | 'accessory';

/** 1 dòng sản phẩm bị hoàn (giảm SL) trong 1 lần hoàn tiền. */
export interface OrderRefundItem {
  productName: string;
  qtyRefunded: number;
  unitPrice: number;
  amount: number; // qtyRefunded * unitPrice (VND)
}

/** 1 lần hoàn tiền (đơn ĐÃ THANH TOÁN giảm SL) — bảng order_refunds. */
export interface OrderRefund {
  id: string;
  amount: number; // VND
  reason?: string;
  items: OrderRefundItem[];
  createdAt?: unknown; // ISO timestamptz
  createdBy?: string;
  // Đối soát (008/#186): gắn giao dịch SePay 'out' hoặc đánh dấu tiền mặt.
  transactionId?: string | null;
  reconciled?: boolean;
  reconcileMethod?: 'sepay' | 'cash' | null;
  reconciledAt?: unknown; // ISO timestamptz
  reconciledBy?: string | null;
}

/** 1 phiếu hoàn (mọi đơn) kèm ngữ cảnh đơn — dùng đối soát từ phía GD tiền ra. */
export interface RefundListItem {
  refundId: string;
  orderId: string;
  orderNumber?: string | null;
  amount: number; // VND
  reason?: string | null;
  createdAt?: unknown; // ISO timestamptz
  transactionId?: string | null;
  reconciled: boolean;
  reconcileMethod?: 'sepay' | 'cash' | null;
}

/** Payload tuỳ chọn khi cập nhật đơn để ghi nhận hoàn tiền. */
export interface OrderRefundInput {
  amount?: number; // nếu bỏ trống → BE tính = total_cũ − total_mới
  reason?: string;
}

export interface OrderFieldChange {
  field: string;
  label?: string;
  oldValue: string | number | null;
  newValue: string | number | null;
}

export interface OrderHistoryEntry {
  at: unknown;
  by?: string;
  byUid?: string;
  changes: OrderFieldChange[];
}

export interface OrderCustomer {
  id?: string;
  name?: string;
  phone?: string;
  address?: string;
  email?: string;
  city?: string;
  country?: string;
}

/** Order trả về cho FE (đã enrich createdBy = display name). */
export interface Order {
  id: string;
  orderNumber?: string;
  sepayId?: number | null;
  customer: OrderCustomer;
  customerName?: string;
  phone?: string;
  address?: string;
  email?: string;
  items: OrderItem[];
  decorations?: OrderDecoration[];
  /** Phụ thu tổng cho cả đơn (VND) — cộng vào subtotal TRƯỚC giảm. Đơn cũ = 0. */
  surchargeAmount?: number;
  /** Nhãn loại phụ thu (null nếu không có). */
  surchargeTag?: SurchargeTag | string | null;
  /** Tổng tiền hàng TRƯỚC giảm (items + decorations + surcharge). */
  subtotal?: number;
  /** Tổng tiền đã giảm bởi khuyến mãi. */
  discountAmount?: number;
  /** Các khuyến mãi đã áp vào đơn. */
  appliedPromotions?: AppliedPromotion[];
  /** Quà tặng (Mua X tặng Y) — giá 0. */
  giftItems?: GiftItem[];
  /** = subtotal + shippingCost − discountAmount. */
  total: number;
  shippingCost?: number;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  deliveryType?: string;
  orderDate?: unknown;
  deliveryDate?: string | null;
  deliveryTime?: string | null;
  note?: string;
  /** UID gốc của người tạo (giữ nguyên để check quyền / lookup). */
  createdByUid?: string;
  /** Tên hiển thị người tạo (đã resolve từ users) — để FE hiển thị. */
  createdBy?: string;
  updatedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  history?: OrderHistoryEntry[];
  isTest?: boolean;
  commissionAmount?: number;
  commissionStatus?: 'pending' | 'paid';
  /** ISO thời điểm trả hoa hồng (cột commission_paid_at). */
  commissionPaidAt?: string | null;
  /** Tổng tiền đã hoàn cho đơn (cộng dồn qua nhiều lần). Đơn cũ = 0. */
  refundedAmount?: number;
  /** Thời điểm hoàn gần nhất (ISO timestamptz) — null nếu chưa hoàn. */
  refundedAt?: string | null;
  /** Lý do hoàn gần nhất. */
  refundReason?: string | null;
  /** Người thực hiện hoàn gần nhất (display name / uid). */
  refundedBy?: string | null;
  /** Lý do huỷ đơn (vá nợ kỹ thuật). */
  cancelReason?: string | null;
  /** Thời điểm huỷ đơn (ISO timestamptz). */
  cancelledAt?: string | null;
  /** Người huỷ đơn. */
  cancelledBy?: string | null;
  /** Lịch sử các lần hoàn tiền (mới → cũ). */
  refunds?: OrderRefund[];
}

/** Kết quả app.order_update: order sau cập nhật + diff + snapshot trước (FE gửi Zalo). */
export interface OrderUpdateResult extends Order {
  changes: OrderFieldChange[];
  prevOrder: Order;
}

/** Kết quả app.order_delete: id + snapshot đã xoá (FE gửi Zalo delete notify). */
export interface OrderDeleteResult {
  id: string;
  prevOrder: Order | null;
}

/** Enum default mirror FE (frontend/types/enums.ts). */
export const PAYMENT_STATUS_UNPAID = 'UNPAID';
export const PAYMENT_METHOD_CASH = 'CASH';
export const DELIVERY_TYPE_SHIP = 'SHIP';
