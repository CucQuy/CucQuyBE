-- 027: Chi phí THỦ CÔNG — khoản chi KHÔNG qua bank (tiền mặt / đã trả từ trước / trước khi
-- có hệ thống). Bổ khuyết cho chi phí auto-từ-bank: có khoản không sinh giao dịch để gán.
--
-- Phân bổ: spread_months >= 1. amount/spread_months mỗi tháng, mốc = date + i tháng
-- (i = 0..spread_months-1) — giống khấu hao tài sản. spread_months = 1 → ghi 1 lần vào
-- tháng của `date`. revenue.sql + expense_summary cộng phần rơi trong kỳ vào chi phí.
CREATE TABLE IF NOT EXISTS manual_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date NOT NULL,                                   -- ngày phát sinh / bắt đầu phân bổ
  amount        numeric NOT NULL CHECK (amount >= 0),            -- VND (tổng khoản chi)
  category      text NOT NULL,                                   -- rent|utilities|... (ExpenseCategory)
  spread_months integer NOT NULL DEFAULT 1 CHECK (spread_months >= 1), -- số tháng phân bổ
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_expenses_date ON manual_expenses(date);
