-- ============================================================
-- 014 — Bổ sung trường kênh/loại NCC cho bảng suppliers.
--
-- Bối cảnh: phân loại NCC theo kênh nguồn hàng
-- (shopee/tiktok/cho/facebook/si/khac). Lưu dạng text tự do
-- (BE KHÔNG enforce union), giống cách xử lý `category` ở migration 011.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS channel text;
