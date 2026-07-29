-- ============================================================
-- 037 — Giảm giá TAY nhiều dòng theo đơn (giống phụ thu, ngược dấu).
-- Thêm 2 cột vào orders:
--   discounts jsonb = [{note, amount}] — các khoản giảm giá tay (note tự do + số tiền VND).
--   manual_discount_amount numeric — TỔNG giảm giá tay = sum(discounts.amount), trừ vào total
--     SAU giảm khuyến mãi (floor 0). Tách riêng discount_amount (KM) để không lẫn.
-- Backward compat: đơn cũ discounts = [] / manual_discount_amount = 0 → total không đổi.
-- Idempotent: chỉ ADD khi cột chưa tồn tại.
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_discount_amount numeric NOT NULL DEFAULT 0;
