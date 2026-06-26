-- ============================================================
-- 006 — Hoàn tiền khi giảm số lượng trên đơn ĐÃ THANH TOÁN (issue #179).
--
-- Khi order_update chạy trên đơn payment_status (CŨ) = 'PAID' và có item GIẢM
-- số lượng → ghi nhận 1 bản ghi hoàn tiền (refund). Tiền hoàn = total_cũ −
-- total_mới (recompute thẩm quyền qua promotion_compute, chuẩn cả KM/phụ thu).
-- Hỗ trợ nhiều lần (mỗi lần giảm = 1 dòng order_refunds). Giữ payment_status='PAID'.
-- Refund ghi nhận nội bộ (KHÔNG đụng SePay/transactions).
--
-- Bảng order_refunds: chi tiết từng lần hoàn (items = các dòng giảm).
-- Vá nợ kỹ thuật: thêm cột refund/cancel vào orders (nullable/default an toàn
-- cho đơn cũ) để persist tổng hoàn + lý do + người + thời điểm.
--
-- ⚠️ timestamptz KHÔNG nhận text/to_char — dùng now() / biến timestamptz, đừng
-- so sánh <> '' (đã gây nhiều 500). Áp dụng cho refunded_at/cancelled_at/created_at.
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_refunds (
  id         text NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  order_id   text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount     numeric NOT NULL,                 -- số tiền hoàn (VND) của lần này
  reason     text,                             -- lý do hoàn (tuỳ chọn)
  items      jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{productName, qtyRefunded, unitPrice, amount}]
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text                              -- người thực hiện (display name / uid)
);
CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON order_refunds(order_id);

-- Vá nợ kỹ thuật: cột refund + cancel trên orders (an toàn cho đơn cũ).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at      timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason    text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_by      text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason    text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at     timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by     text;
