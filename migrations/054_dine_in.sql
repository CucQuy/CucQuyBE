-- 054_dine_in.sql — Order theo bàn (dine-in).
-- Bàn ăn tại chỗ: mỗi bàn khi có khách → gắn 1 ĐƠN HÀNG THẬT (orders.table_id) nên
-- chảy qua doanh thu / QR / bill như đơn thường. Bàn quản lý ĐỘNG (thêm/xoá/kéo vị trí
-- trên sơ đồ). Vị trí bàn lưu toạ độ chuẩn hoá 0..1 theo khung sơ đồ SVG ở FE.

-- Danh mục bàn (registry). Xoá = soft (active=false) để giữ FK từ đơn lịch sử.
CREATE TABLE IF NOT EXISTS dine_in_tables (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  pos_x      numeric NOT NULL DEFAULT 0.1,  -- 0..1 theo chiều ngang khung sơ đồ
  pos_y      numeric NOT NULL DEFAULT 0.1,  -- 0..1 theo chiều dọc khung sơ đồ
  seats      int     NOT NULL DEFAULT 4,
  sort_order int     NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Đơn gắn bàn: table_id + số khách + giờ vào/ra. Bàn "đang ngồi" = có đơn table_id
-- với left_at IS NULL và status chưa huỷ. "Đóng bàn" = set left_at.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_id    text REFERENCES dine_in_tables(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_count int;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seated_at   timestamptz;  -- giờ vào
ALTER TABLE orders ADD COLUMN IF NOT EXISTS left_at     timestamptz;  -- giờ ra

-- Tra nhanh "đơn đang mở của bàn X".
CREATE INDEX IF NOT EXISTS idx_orders_table_open
  ON orders(table_id) WHERE table_id IS NOT NULL AND left_at IS NULL;

-- Seed 2 bàn mặc định (góc trái trên & trái dưới của sơ đồ) — chỉ khi bảng còn rỗng.
INSERT INTO dine_in_tables (id, name, pos_x, pos_y, seats, sort_order)
SELECT * FROM (VALUES
  (replace(gen_random_uuid()::text, '-', ''), 'Bàn 1', 0.18::numeric, 0.42::numeric, 4, 1),
  (replace(gen_random_uuid()::text, '-', ''), 'Bàn 2', 0.18::numeric, 0.68::numeric, 4, 2)
) AS v(id, name, pos_x, pos_y, seats, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM dine_in_tables);
