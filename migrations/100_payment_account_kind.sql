-- ============================================================
-- 100 — Đơn giản hoá 099: `payment_accounts.purpose` (receive/spend) → `kind` (hkd/personal).
--
-- Gọi đúng tên thứ tiệm đang có thay vì vai trò trừu tượng:
--   'hkd'      — TK hộ kinh doanh: khách CK vào đây (QR đơn trỏ vào TK HKD đang dùng).
--   'personal' — TK cá nhân: cuối ngày TK HKD dồn hết tiền sang, rồi chi mọi hoá đơn từ đây.
-- Logic dồn tiền nội bộ giữ nguyên (status sweep_out ở TK HKD / sweep_in ở TK cá nhân).
--
-- Map giá trị cũ: receive → hkd, spend → personal.
-- Mỗi kind vẫn có 1 TK "đang dùng" (unique index đổi tên theo cột).
--
-- Function đi kèm (chạy SAU migration này):
--   functions/transactions.sql   — payment_account_kind() + webhook BỎ QUA TK tắt ghi nhận
--   functions/configurations.sql — payment_account_set_kind()
--   functions/ledger.sql         — sweep + byAccount theo kind
--   functions/webhooks.sql       — trả {skipped:true} khi TK tắt ghi nhận
-- ============================================================

-- Rename cột (idempotent: chỉ đổi khi còn tên cũ).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'payment_accounts' AND column_name = 'purpose')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'payment_accounts' AND column_name = 'kind') THEN
    ALTER TABLE payment_accounts RENAME COLUMN purpose TO kind;
  END IF;
END $$;

ALTER TABLE payment_accounts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'hkd';

-- CHECK cũ chặn giá trị mới → gỡ TRƯỚC khi map dữ liệu.
ALTER TABLE payment_accounts DROP CONSTRAINT IF EXISTS payment_accounts_purpose_chk;
ALTER TABLE payment_accounts DROP CONSTRAINT IF EXISTS payment_accounts_kind_chk;

UPDATE payment_accounts
   SET kind = CASE kind WHEN 'receive' THEN 'hkd' WHEN 'spend' THEN 'personal' ELSE kind END
 WHERE kind IN ('receive', 'spend');

ALTER TABLE payment_accounts ALTER COLUMN kind SET DEFAULT 'hkd';
ALTER TABLE payment_accounts
  ADD CONSTRAINT payment_accounts_kind_chk CHECK (kind IN ('hkd', 'personal'));

COMMENT ON COLUMN payment_accounts.kind IS
  'hkd = TK hộ kinh doanh (nhận tiền khách, QR đơn) · personal = TK cá nhân (nhận dồn cuối ngày, chi hoá đơn).';

COMMENT ON COLUMN payment_accounts.is_tracked IS
  'Ghi nhận giao dịch của TK này. false → webhook SePay BỎ QUA, không lưu giao dịch (100).';

-- Index đổi tên theo cột (tối đa 1 TK đang dùng mỗi kind).
DROP INDEX IF EXISTS payment_accounts_one_active_per_purpose_idx;
DROP INDEX IF EXISTS payment_accounts_purpose_idx;
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_one_active_per_kind_idx
  ON payment_accounts (kind) WHERE is_active;
CREATE INDEX IF NOT EXISTS payment_accounts_kind_idx ON payment_accounts (kind);

-- Function bản 099 (tên theo purpose) — thay bằng *_kind ở functions/*.sql.
DROP FUNCTION IF EXISTS payment_account_purpose(text, text);
DROP FUNCTION IF EXISTS payment_account_set_purpose(text, text);
