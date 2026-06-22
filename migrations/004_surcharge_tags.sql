-- ============================================================
-- 004 — Tag phụ thu (issue #23).
-- Bảng surcharge_tags: danh mục loại phụ thu cho đơn (cộng vào subtotal trước giảm).
--   key text PRIMARY KEY — id ổn định, đơn cũ map theo key (orders.surcharge_tag).
--   label text          — nhãn hiển thị.
--   preset numeric      — mức gợi ý VND (default 0).
--   active boolean      — bật/tắt (default true).
--   sort_order int      — vị trí sort (default 0).
-- Seed 3 row trùng value cũ (no-regression đơn cũ):
--   decoration / Trang trí / 1000 — theme / Theme / 0 — accessory / Phụ kiện / 0.
-- Idempotent: CREATE TABLE IF NOT EXISTS + seed ON CONFLICT (key) DO NOTHING.
-- ============================================================
CREATE TABLE IF NOT EXISTS surcharge_tags (
  key        text PRIMARY KEY,
  label      text NOT NULL,
  preset     numeric DEFAULT 0,
  active      boolean DEFAULT true,
  sort_order int DEFAULT 0
);

INSERT INTO surcharge_tags (key, label, preset, active, sort_order) VALUES
  ('decoration', 'Trang trí', 1000, true, 0),
  ('theme',      'Theme',        0, true, 1),
  ('accessory',  'Phụ kiện',     0, true, 2)
ON CONFLICT (key) DO NOTHING;
