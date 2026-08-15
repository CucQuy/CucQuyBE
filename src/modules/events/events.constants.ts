/**
 * Hợp đồng sự kiện socket — PHẢI khớp FE (services/socket/events.ts).
 * Tên sự kiện + shape payload gom 1 chỗ để FE/BE không lệch nhau.
 */
export const SOCKET_EVENTS = {
  /** Đơn vừa được thanh toán (webhook SePay tiền vào khớp mã đơn). */
  ORDER_PAID: 'order:paid',
  /** Trạng thái bàn ăn tại chỗ đổi (mở/sửa/đóng bàn, thêm/xoá bàn) — client refetch. */
  TABLES_CHANGED: 'tables:changed',
} as const;

/** Payload sự kiện `order:paid`. */
export interface OrderPaidEvent {
  orderNumber: string;
  amount: number; // VND
}

/** Payload `tables:changed` — nhẹ, client chỉ dùng để invalidate + refetch danh sách bàn. */
export interface TablesChangedEvent {
  reason?: string; // 'open' | 'update' | 'checkout' | 'table' ...
}
