/**
 * Topic MQTT của app. Đặt chung 1 chỗ để BE (và client ngoài) không lệch nhau.
 * Prefix "cucquy/" để tách namespace nếu broker dùng chung nhiều app.
 */
export const MQTT_TOPICS = {
  /** Đơn vừa thanh toán (webhook SePay khớp mã đơn) — mirror sự kiện socket order:paid. */
  ORDER_PAID: 'cucquy/orders/paid',
} as const;
