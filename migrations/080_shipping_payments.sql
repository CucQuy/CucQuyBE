-- ============================================================
-- Thanh toán VẬN CHUYỂN (ship): gắn 1 GIAO DỊCH tiền RA với 1 ĐƠN hoặc 1 NHÀ XE (carrier).
-- Phục vụ "đối soát chặt chẽ" tiền ra ship: trả cho đơn nào / nhà xe (ĐVVC) nào.
-- Mỗi GD ra ↔ TỐI ĐA 1 phiếu ship (uniq index). Bắt buộc có ít nhất order_id HOẶC carrier_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS shipping_payments (
  id             text PRIMARY KEY DEFAULT ('shp_' || encode(gen_random_bytes(9), 'hex')),
  transaction_id text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  order_id       text REFERENCES orders(id)   ON DELETE SET NULL,
  carrier_id     text REFERENCES carriers(id) ON DELETE SET NULL,
  amount         numeric NOT NULL CHECK (amount > 0),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text,
  -- Phải gắn ít nhất 1 mục tiêu (đơn hoặc nhà xe).
  CONSTRAINT shipping_payment_target CHECK (order_id IS NOT NULL OR carrier_id IS NOT NULL)
);

-- 1 giao dịch tiền ra chỉ gắn 1 phiếu ship.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_shipping_txn ON shipping_payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_shipping_order   ON shipping_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_carrier ON shipping_payments(carrier_id);
