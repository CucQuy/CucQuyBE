/**
 * Topic MQTT của app — KHỚP firmware ESP32 (NamPOS): cucquy/<device>/order/create
 * và cucquy/<device>/order/paid. Device id đổi qua env POS_DEVICE_ID (mặc định esp_01).
 */
const DEVICE_ID = process.env.POS_DEVICE_ID || 'esp_01';

export const MQTT_TOPICS = {
  /** Đẩy QR thanh toán động lên màn hình thiết bị (lúc tạo/mở đơn). ESP32 sub topic này.
   *  Payload: { order_id, amount, qr (chuỗi VietQR EMV thô) }. Retain để nối sau vẫn thấy. */
  ORDER_CREATE: `cucquy/${DEVICE_ID}/order/create`,
  /** Đơn đã thanh toán (webhook SePay khớp) → ESP32 kêu loa + TTS + về màn chờ.
   *  Payload: { order_id, amount }. KHÔNG retain (sự kiện 1 lần). */
  ORDER_PAID: `cucquy/${DEVICE_ID}/order/paid`,
} as const;
