/**
 * Hợp đồng sự kiện socket — PHẢI khớp FE (services/socket/events.ts).
 * Tên sự kiện + shape payload gom 1 chỗ để FE/BE không lệch nhau.
 */
export const SOCKET_EVENTS = {
  /** Đơn vừa được thanh toán (webhook SePay tiền vào khớp mã đơn). */
  ORDER_PAID: 'order:paid',
  /** Job in bill/phiếu bếp → agent máy in ở quán (relay từ FE qua BE). */
  PRINT_JOB: 'print:job',
  /** Đơn hàng MỚI vừa được tạo → máy quán (kiosk) phát âm + tự in phiếu bếp. */
  ORDER_CREATED: 'order:created',
} as const;

/** Payload sự kiện `order:paid`. */
export interface OrderPaidEvent {
  orderNumber: string;
  amount: number; // VND
}

/** Payload sự kiện `print:job`: luồng ESC/POS thô đã encode base64. */
export interface PrintJobEvent {
  base64: string;
}

/** Payload sự kiện `order:created`: đủ để máy quán fetch lại đơn đầy đủ + in phiếu bếp. */
export interface OrderCreatedEvent {
  id: string;
  orderNumber: string;
}
