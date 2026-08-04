-- Hồ sơ nhân sự (nhân viên) — độc lập với tài khoản đăng nhập (users).
-- MVP: thông tin cơ bản + CRUD. Có thể mở rộng sau (chấm công, lương chi tiết...).
CREATE TABLE IF NOT EXISTS employees (
  id          text PRIMARY KEY,
  name        text NOT NULL,               -- họ tên
  position    text,                          -- chức vụ (thợ bánh, bán hàng, ship...)
  phone       text,
  start_date  date,                          -- ngày vào làm
  base_salary numeric,                       -- lương cơ bản (VND)
  status      text NOT NULL DEFAULT 'active',-- active (đang làm) | inactive (đã nghỉ)
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
