-- Danh sách "vị" quản lý tập trung (có màu) — dùng cho sản phẩm & đơn hàng.
CREATE TABLE IF NOT EXISTS flavors (
  id text PRIMARY KEY,
  name text NOT NULL,
  color text,
  sort_order int
);
