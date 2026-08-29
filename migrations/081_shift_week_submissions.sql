-- Chốt đăng ký ca theo TUẦN: mỗi NV × tuần (thứ 2) 1 bản ghi khi bấm "Chốt".
-- Đã chốt => shift_register_self khoá (NV không sửa được); admin sửa thẳng qua set_day
-- hoặc "mở lại" (xoá bản ghi) để NV đăng ký lại.
CREATE TABLE IF NOT EXISTS shift_week_submissions (
  id           text PRIMARY KEY,
  employee_id  text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start   date NOT NULL,                    -- thứ 2 (ISO) của tuần đăng ký
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_by text,                             -- email người chốt (NV tự chốt / admin)
  UNIQUE (employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_shift_week_sub_week ON shift_week_submissions (week_start);
