-- ============================================================
-- 005 — Cấu hình tài khoản thanh toán (issue #176).
-- Bảng payment_config: single-row lưu 1 tài khoản nhận tiền (mirror shipping_config).
--   id text PRIMARY KEY DEFAULT 'payment' — chốt 1 dòng duy nhất.
--   bank_code      text — mã ngân hàng (VD 'BIDV').
--   account_number text — số tài khoản.
--   account_holder text — tên chủ tài khoản.
--   qr_template    text DEFAULT 'compact' — template QR (VietQR).
--   updated_at     timestamptz — thời điểm cập nhật gần nhất.
-- Seed 1 row giá trị hiện tại đang dùng.
-- Idempotent: CREATE TABLE IF NOT EXISTS + seed ON CONFLICT (id) DO NOTHING.
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_config (
  id             text PRIMARY KEY DEFAULT 'payment',
  bank_code      text,
  account_number text,
  account_holder text,
  qr_template    text DEFAULT 'compact',
  updated_at     timestamptz
);

INSERT INTO payment_config (id, bank_code, account_number, account_holder, qr_template, updated_at)
VALUES ('payment', 'BIDV', '96247HTTH1308', 'TON THAT ANH MINH', 'compact', now())
ON CONFLICT (id) DO NOTHING;
