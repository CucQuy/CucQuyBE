-- ============================================================
-- Nhà xe (coaches) — danh bạ nhà xe dùng lại cho hình thức "Ship xe khách".
-- + cột orders.coach_info (jsonb) lưu snapshot nhà xe đã chọn trên từng đơn.
-- Additive, an toàn re-run.
-- ============================================================
CREATE TABLE IF NOT EXISTS coaches (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  phone        text,
  route        text,        -- tuyến: "Bến A → Bến B"
  pickup_point text,        -- điểm nhận/gửi hàng
  default_fee  numeric,     -- phí gửi mặc định (VND)
  note         text,
  sort_order   int DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS coach_info jsonb;
