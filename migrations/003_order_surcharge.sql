-- ============================================================
-- 003 — Phụ thu tổng theo đơn (issue #17).
-- Thêm 2 cột vào orders:
--   surcharge_amount numeric DEFAULT 0 — tổng tiền phụ thu cho CẢ đơn (VND),
--     cộng vào subtotal TRƯỚC giảm giá (giống decoration).
--   surcharge_tag text — nhãn loại phụ thu ('decoration'|'theme'|'accessory').
-- Backward compat: đơn cũ surcharge_amount = 0 / surcharge_tag NULL → hành xử như cũ.
-- KHÔNG đụng bảng order_decorations (giữ nguyên cho đơn cũ).
-- Idempotent: chỉ ADD khi cột chưa tồn tại.
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS surcharge_amount numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS surcharge_tag text;
