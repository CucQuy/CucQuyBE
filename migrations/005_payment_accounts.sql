-- ============================================================
-- 005 — Tài khoản nhận tiền (issue #176).
-- Đổi mô hình: từ 1 dòng payment_config → NHIỀU tài khoản, tối đa 1 active.
-- Mọi QR đơn dùng tài khoản đang active.
-- Bảng payment_accounts:
--   id             text PRIMARY KEY DEFAULT gen_random_uuid()::text — id theo convention project.
--   bank_code      text NOT NULL — mã ngân hàng (VD 'BIDV').
--   account_number text NOT NULL — số tài khoản.
--   account_holder text NOT NULL — tên chủ tài khoản.
--   qr_template    text NOT NULL DEFAULT 'compact' — template QR (VietQR).
--   is_active      boolean NOT NULL DEFAULT false — tài khoản đang dùng nhận tiền.
--   created_at     timestamptz NOT NULL DEFAULT now().
-- Partial unique index: tối đa 1 tài khoản active.
-- Seed 1 tài khoản hiện tại làm active (chỉ khi bảng rỗng → idempotent).
-- DROP bảng cũ payment_config (chưa deploy production → viết đè).
-- ============================================================

DROP TABLE IF EXISTS payment_config;

CREATE TABLE IF NOT EXISTS payment_accounts (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  bank_code      text NOT NULL,
  account_number text NOT NULL,
  account_holder text NOT NULL,
  qr_template    text NOT NULL DEFAULT 'compact',
  is_active      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Tối đa 1 tài khoản active mọi lúc.
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_one_active_idx
  ON payment_accounts (is_active) WHERE is_active;

-- Seed tài khoản hiện tại làm active (chỉ khi bảng rỗng).
INSERT INTO payment_accounts (bank_code, account_number, account_holder, qr_template, is_active)
SELECT 'BIDV', '96247HTTH1308', 'TON THAT ANH MINH', 'compact', true
WHERE NOT EXISTS (SELECT 1 FROM payment_accounts);
