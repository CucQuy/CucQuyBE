-- 028: Cờ "cần đối soát" cho giao dịch SePay.
-- Dùng khi webhook không trích được mã đơn từ nội dung (ngân hàng khác ghi đè nội dung)
-- và khớp theo SỐ TIỀN lại ra ≥2 đơn cùng total → không auto-PAID, gắn cờ để đối soát tay.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS review_note  text;
