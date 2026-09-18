-- ============================================================
-- 099 — Mục đích tài khoản: TK NHẬN TIỀN vs TK CHI (`payment_accounts.purpose`).
--
-- Dòng tiền thật của tiệm (trước đây chỉ nằm trong đầu, sổ không phân biệt được):
--   1. Khách CK vào TK NHẬN (purpose='receive') — QR đơn luôn trỏ vào TK nhận đang active.
--   2. CUỐI NGÀY dồn tiền từ TK nhận → TK CHI (purpose='spend'). Trên sổ là 2 giao dịch
--      của CÙNG 1 dòng tiền: 1 GD ra ở TK nhận + 1 GD vào ở TK chi → luân chuyển NỘI BỘ,
--      KHÔNG phải doanh thu/chi phí (status `sweep_out` / `sweep_in`, xem functions/ledger.sql).
--   3. Mọi hoá đơn (NCC, ship, chi phí vận hành) chi TỪ TK chi → đối soát tiền ra ở TK chi.
--
-- `is_active` giữ nghĩa "TK đang dùng" nhưng giờ tính theo TỪNG purpose:
--   1 TK nhận chính (QR đơn) + 1 TK chi chính (chi hoá đơn).
--   → index unique đổi từ (is_active) sang (purpose) WHERE is_active.
--
-- `is_tracked` (076) độc lập: TK chi cũng phải tracked mới thấy hoá đơn chi trong sổ.
--
-- Function đi kèm (chạy SAU migration này):
--   migrations/functions/transactions.sql  — payment_account_purpose()
--   migrations/functions/expenses.sql      — 'sweep' vào nhóm phi-chi-phí
--   migrations/functions/configurations.sql — payment_accounts_list/create/set_purpose
--   migrations/functions/ledger.sql        — status sweep_in/sweep_out + dòng tiền theo TK
-- ============================================================

ALTER TABLE payment_accounts
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'receive';

COMMENT ON COLUMN payment_accounts.purpose IS
  'receive = TK nhận tiền khách (QR đơn) · spend = TK chi hoá đơn (nhận tiền dồn cuối ngày từ TK nhận).';

ALTER TABLE payment_accounts DROP CONSTRAINT IF EXISTS payment_accounts_purpose_chk;
ALTER TABLE payment_accounts
  ADD CONSTRAINT payment_accounts_purpose_chk CHECK (purpose IN ('receive', 'spend'));

-- Tối đa 1 TK active MỖI purpose (trước là 1 TK active toàn bảng).
DROP INDEX IF EXISTS payment_accounts_one_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_one_active_per_purpose_idx
  ON payment_accounts (purpose) WHERE is_active;

-- Lọc nhanh theo mục đích (ledger join theo account_number nên index này chỉ cho list/filter).
CREATE INDEX IF NOT EXISTS payment_accounts_purpose_idx ON payment_accounts (purpose);
