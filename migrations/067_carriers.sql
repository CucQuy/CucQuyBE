-- Đơn vị vận chuyển (ĐVVC) — danh bạ đối tác giao hàng (nhóm "Đối tác" cùng KH/NCC).
CREATE TABLE IF NOT EXISTS carriers (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  phone      text,
  note       text,
  active     boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
