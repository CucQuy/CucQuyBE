-- ============================================================
-- NHIỀU giao dịch tiền ra / 1 bill (phiếu nhập) — phân bổ theo số tiền.
--  * 1 bill gắn nhiều GD; 1 GD chia được cho nhiều bill (theo amount).
--  * Bill "đối soát xong" (reconciled) khi TỔNG amount đã gắn >= total_amount.
--  * Tổng amount của 1 GD không vượt transfer_amount của nó (chống đếm trùng tiền ra).
-- Thay cho stock_receipts.transaction_id (1:1, migration 009) — cột đó giữ lại (legacy,
-- = 1 alloc đầu để hiển thị cũ không vỡ), logic đối soát chuyển sang bảng này.
-- ============================================================
CREATE TABLE IF NOT EXISTS receipt_tx_allocations (
  id             text PRIMARY KEY,
  receipt_id     text NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
  transaction_id text NOT NULL REFERENCES transactions(id)   ON DELETE CASCADE,
  amount         numeric NOT NULL CHECK (amount > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_rta_receipt ON receipt_tx_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_rta_tx      ON receipt_tx_allocations(transaction_id);

-- Migrate link 1:1 cũ → allocation (amount = số tiền GD; mỗi GD cũ chỉ thuộc 1 bill nên an toàn).
INSERT INTO receipt_tx_allocations (id, receipt_id, transaction_id, amount)
SELECT 'rta_' || encode(gen_random_bytes(9), 'hex'), s.id, s.transaction_id,
       COALESCE(t.transfer_amount, s.total_amount)
FROM stock_receipts s
JOIN transactions t ON t.id = s.transaction_id
WHERE s.transaction_id IS NOT NULL
  AND COALESCE(t.transfer_amount, s.total_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM receipt_tx_allocations a
    WHERE a.receipt_id = s.id AND a.transaction_id = s.transaction_id
  )
ON CONFLICT (receipt_id, transaction_id) DO NOTHING;
