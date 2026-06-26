-- ============================================================
-- 008 — Đối soát phiếu hoàn tiền (order_refunds) với giao dịch SePay
--       tiền RA (transactions.transfer_type='out') — issue #186.
--
-- Bối cảnh: order_refunds (006/#179) ghi nhận từng lần hoàn nội bộ, CHƯA gắn
-- với dòng tiền thực tế. Tính năng này cho phép gạch nợ 1 phiếu hoàn ↔ 1 giao
-- dịch SePay 'out' (đối soát theo mã giao dịch), HOẶC đánh dấu "trả tiền mặt"
-- (không cần giao dịch). 1 giao dịch out KHÔNG được gắn cho 2 phiếu (unique index).
--
-- ⚠️ timestamptz dùng now() / biến timestamptz — KHÔNG so sánh <> '' (fallout 002).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- ============================================================

-- Cột đối soát trên order_refunds.
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS transaction_id  text;
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS reconciled      boolean NOT NULL DEFAULT false;
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS reconcile_method text;        -- 'sepay' | 'cash'
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS reconciled_at    timestamptz;
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS reconciled_by    text;

-- FK transaction_id -> transactions(id), gỡ giao dịch thì set NULL (giữ phiếu).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_transaction_id_fkey'
  ) THEN
    ALTER TABLE order_refunds
      ADD CONSTRAINT order_refunds_transaction_id_fkey
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
  END IF;
END$$;

-- 1 giao dịch out chỉ được gắn cho TỐI ĐA 1 phiếu hoàn (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_refund_txn
  ON order_refunds(transaction_id) WHERE transaction_id IS NOT NULL;
