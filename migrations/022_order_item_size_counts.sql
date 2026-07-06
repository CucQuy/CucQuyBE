-- Cho phép 1 dòng đơn chứa NHIỀU size với số lượng riêng (vd 2 Gia Đình + 1 Lẻ).
-- Lưu [{name, qty}]. Giá dòng = tổng qty×giá size. Cột `size` (đơn) giữ cho tương thích.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size_counts jsonb;
