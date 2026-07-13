-- 011: Chi phí vận hành AUTO từ bank "tiền ra" (không nhập tay).
-- Thêm cột phân loại chi phí + cờ "loại khỏi chi phí" lên transactions;
-- bảng rule từ khoá (nội dung CK → category) để auto phân loại; manual là backup.
--
-- Định nghĩa OPEX (revenue.sql): out AND settled_out=false AND cost_excluded=false
--   AND không gắn order_refund. expense_category chỉ để breakdown (pie), KHÔNG
--   ảnh hưởng việc tính là chi phí — mọi tiền ra "chưa loại" đều tính (auto), user
--   đánh dấu cost_excluded để loại (nội bộ / trả NCC đã tính COGS / ...).

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expense_category text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cost_excluded boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS expense_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword    text NOT NULL,   -- so khớp (chuẩn hoá UPPER, không dấu) với nội dung CK
  category   text NOT NULL,   -- rent|utilities|internet|marketing|maintenance|salary|other
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_out_expense
  ON transactions(transfer_type, expense_category);
