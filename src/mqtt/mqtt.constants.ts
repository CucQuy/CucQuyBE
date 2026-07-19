/**
 * Topic MQTT của app. Đặt chung 1 chỗ để BE (và client ngoài) không lệch nhau.
 * Prefix "cucquy/" để tách namespace nếu broker dùng chung nhiều app.
 */
export const MQTT_TOPICS = {
  /** Đơn vừa thanh toán (webhook SePay khớp mã đơn) — mirror sự kiện socket order:paid.
   *  Thiết bị POS/ESP32 nghe để chuyển màn "đã thanh toán" + kêu loa. */
  ORDER_PAID: 'cucquy/orders/paid',
  /** Đẩy QR thanh toán động xuống màn hình thiết bị POS/ESP32 (retain: nối sau vẫn thấy).
   *  Payload: { order_id, amount, qr (chuỗi VietQR EMV thô), at } hoặc { cleared: true }. */
  POS_QR: 'cucquy/pos/qr',
} as const;
