-- ============================================================
-- 101 — Bỏ khái niệm "TK đang dùng" (is_active) khỏi UI: LOẠI TÀI KHOẢN chính là cái
-- đánh dấu, và mỗi loại CHỈ ĐÚNG 1 TÀI KHOẢN.
--
--   kind = 'hkd'      → TK hộ kinh doanh   (duy nhất 1) — khách CK vào, QR đơn dùng TK này.
--   kind = 'personal' → TK cá nhân          (duy nhất 1) — nhận dồn cuối ngày, chi hoá đơn.
--   kind = 'none'     → TK không dùng (nhiều bao nhiêu cũng được) — TK cũ giữ lại để tra cứu.
--
-- Gán 1 TK làm 'hkd' thì TK 'hkd' cũ tự rớt về 'none' (payment_account_set_kind lo).
-- `is_active` giữ lại làm cột suy ra (= kind <> 'none') để query cũ không vỡ; không còn
-- endpoint/nút bật-tắt riêng.
--
-- Function đi kèm (chạy SAU migration này):
--   functions/configurations.sql — payment_account_set_kind (demote atomic), bỏ set_active
--   functions/transactions.sql   — payment_account_kind() trả NULL cho 'none'
--   functions/ledger.sql         — accountKind NULL cho TK không dùng
-- ============================================================

-- CHECK cũ chỉ cho hkd/personal → gỡ trước khi ghi 'none'.
ALTER TABLE payment_accounts DROP CONSTRAINT IF EXISTS payment_accounts_kind_chk;

-- Chốt dữ liệu: TK không "đang dùng" → 'none'. TK đang dùng giữ nguyên loại
-- (index cũ đã bảo đảm mỗi loại tối đa 1 TK active nên không thể trùng).
UPDATE payment_accounts SET kind = 'none' WHERE NOT is_active;

ALTER TABLE payment_accounts ALTER COLUMN kind SET DEFAULT 'none';
ALTER TABLE payment_accounts
  ADD CONSTRAINT payment_accounts_kind_chk CHECK (kind IN ('hkd', 'personal', 'none'));

COMMENT ON COLUMN payment_accounts.kind IS
  'hkd = TK hộ kinh doanh (duy nhất) · personal = TK cá nhân (duy nhất) · none = không dùng.';
COMMENT ON COLUMN payment_accounts.is_active IS
  'Suy ra từ kind (= kind <> ''none''), giữ cho query cũ — KHÔNG set tay nữa (101).';

-- is_active bám theo kind.
UPDATE payment_accounts SET is_active = (kind <> 'none');

-- Index cũ theo (kind) WHERE is_active → thay bằng: mỗi loại thật chỉ 1 TK, 'none' thoải mái.
DROP INDEX IF EXISTS payment_accounts_one_active_per_kind_idx;
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_one_per_kind_idx
  ON payment_accounts (kind) WHERE kind <> 'none';

-- Không còn bật/tắt "đang dùng" riêng → bỏ hàm.
DROP FUNCTION IF EXISTS payment_account_set_active(text);
DROP FUNCTION IF EXISTS payment_account_set_active(text, boolean);
