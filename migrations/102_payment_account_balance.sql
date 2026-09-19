-- ============================================================
-- 102 — Số dư tài khoản.
--
-- Sổ chỉ có giao dịch, không có số dư đầu kỳ → không biết trong TK còn bao nhiêu.
-- Thêm MỐC CHỐT SỐ DƯ cho mỗi tài khoản:
--   opening_balance    — số dư tại thời điểm chốt (VND).
--   opening_balance_at — thời điểm chốt; NULL = tính từ giao dịch đầu tiên.
--
-- Số dư hiện tại = opening_balance + Σ(tiền vào − tiền ra) của các giao dịch SAU mốc.
-- Chốt lại mốc (nhập số dư đang thấy trên app ngân hàng) thì sai lệch tích luỹ được
-- reset, không phải dò lại từng giao dịch cũ.
--
-- Seed theo số thực tế chủ tiệm đọc từ app (19/09/2026):
--   TK hộ kinh doanh 241101130802 → 0 đ (cuối ngày đã dồn hết sang TK cá nhân)
--   TK cá nhân       0363201848   → 1.428.719 đ
-- Chỉ seed khi CHƯA từng chốt (opening_balance_at IS NULL) → chạy lại không đè số mới.
--
-- Function đi kèm: functions/configurations.sql (payment_account_balance,
-- payment_account_set_opening, list trả balance) + functions/ledger.sql (byAccount.balance).
-- ============================================================

ALTER TABLE payment_accounts
  ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;
ALTER TABLE payment_accounts
  ADD COLUMN IF NOT EXISTS opening_balance_at timestamptz;

COMMENT ON COLUMN payment_accounts.opening_balance IS
  'Số dư tại thời điểm chốt (VND). Số dư hiện tại = giá trị này + giao dịch sau mốc.';
COMMENT ON COLUMN payment_accounts.opening_balance_at IS
  'Thời điểm chốt số dư. NULL = cộng dồn từ giao dịch đầu tiên trong sổ.';

UPDATE payment_accounts
   SET opening_balance = 0, opening_balance_at = now()
 WHERE account_number = '241101130802' AND opening_balance_at IS NULL;

UPDATE payment_accounts
   SET opening_balance = 1428719, opening_balance_at = now()
 WHERE account_number = '0363201848' AND opening_balance_at IS NULL;
