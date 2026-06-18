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
}

export interface OrderDecoration {
  materialId: string;
  name: string;
  quantity: number;
  price: number; // đơn giá VND
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
  /** Tổng tiền hàng TRƯỚC giảm (items + decorations). */
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
