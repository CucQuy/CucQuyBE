-- ============================================================
-- 076 — Cờ TRACKING cho tài khoản nhận tiền.
-- Vấn đề: SePay đẩy webhook của MỌI tài khoản đã đăng ký (kể cả TK cá nhân/TK cũ),
-- `transaction_create_from_sepay` ghi hết vào `transactions` → Sổ giao dịch / đối soát
-- bị trộn data không liên quan tới tiệm. Trước đây chặn bằng HARDCODE số TK trong
-- function (is_test = accountNumber = '0776750418') → mỗi lần đổi TK phải sửa function.
--
-- Giải pháp: `payment_accounts.is_tracked` = tài khoản có được đưa vào sổ/đối soát.
--   is_tracked = true  → giao dịch vào sổ bình thường (TK chính hiện tại + TK từng dùng chính).
--   is_tracked = false → giao dịch VẪN ghi (giữ audit) nhưng gắn `is_test = true`
--                        → status 'test', bị loại khỏi summary + tỷ lệ đối soát.
-- TK lạ KHÔNG có trong payment_accounts cũng được coi là không tracked (xem
-- payment_account_is_tracked ở migrations/functions/transactions.sql).
--
-- Khớp cả `sub_account`: TK ảo BIDV bắn về account_number='5511695317',
-- sub_account='96247HTTH1308' — số nằm trong payment_accounts là số SUB.
-- ============================================================

ALTER TABLE payment_accounts
  ADD COLUMN IF NOT EXISTS is_tracked boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN payment_accounts.is_tracked IS
  'Đưa giao dịch của TK này vào Sổ giao dịch/đối soát. false → tx gắn is_test=true.';

-- MBBank 0776750418 = TK cá nhân, không phải TK tiệm (đã xoá 54 tx rác 18/09/2026).
UPDATE payment_accounts SET is_tracked = false WHERE account_number = '0776750418';
