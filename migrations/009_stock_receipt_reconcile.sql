-- ============================================================
-- 009 — Đối soát phiếu NHẬP KHO (stock_receipts) với giao dịch SePay
--       tiền RA (transactions.transfer_type='out').
--
-- Bối cảnh: tiền ra có 2 loại — HOÀN TIỀN (order_refunds, 008) và THANH TOÁN
-- TỔNG KHO / NCC (nhập hàng). Tính năng này cho phép gạch nợ 1 GD out ↔ 1 phiếu
-- nhập kho. 1 GD out chỉ gắn TỐI ĐA 1 phiếu (unique index).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- ============================================================

ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS transaction_id text;
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS reconciled     boolean NOT NULL DEFAULT false;
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS reconciled_at  timestamptz;
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS reconciled_by  text;

-- FK transaction_id -> transactions(id), gỡ giao dịch thì set NULL (giữ phiếu).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_receipts_transaction_id_fkey'
  ) THEN
    ALTER TABLE stock_receipts
      ADD CONSTRAINT stock_receipts_transaction_id_fkey
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
  END IF;
END$$;

-- 1 giao dịch out chỉ gắn cho TỐI ĐA 1 phiếu nhập (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_receipt_txn
  ON stock_receipts(transaction_id) WHERE transaction_id IS NOT NULL;
