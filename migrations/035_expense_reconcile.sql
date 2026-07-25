-- 035: Đối soát tiền RA (bank) ↔ chi phí thủ công (manual_expenses).
-- Mỗi giao dịch tiền ra gắn TỐI ĐA 1 khoản manual_expenses (transaction_id).
-- Khi đã gắn → tiền ra đó KHÔNG cộng OPEX auto nữa (khoản chi tay đại diện) → chống đếm trùng.
-- Loại-trừ được cài trong revenue.sql (v_total_expenses + cost_expenses) và expense_summary.
ALTER TABLE manual_expenses
  ADD COLUMN IF NOT EXISTS transaction_id text REFERENCES transactions(id) ON DELETE SET NULL;

-- 1 giao dịch tiền ra chỉ được gắn vào 1 khoản chi phí (không đếm trùng nhiều lần).
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_expenses_transaction
  ON manual_expenses(transaction_id) WHERE transaction_id IS NOT NULL;
