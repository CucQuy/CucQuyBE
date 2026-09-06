-- LỊCH SỬ THAY ĐỔI ĐĂNG KÝ CA (2026-09-06).
-- Nhân viên tự đăng ký nên hay tick nhầm ca, admin sửa lại; sau đó không ai nhớ
-- ai đổi, đổi lúc nào, ca gốc là gì → tranh cãi khi tính công.
-- Mỗi thay đổi ghi 1 dòng, KHÔNG xoá theo shift_assignments (giữ cả ca đã bị gỡ).
--
-- action: 'add' (thêm ca) | 'remove' (gỡ ca)
-- source: 'self' (NV tự đăng ký) | 'admin' (admin xếp/sửa) | 'reopen' (admin mở lại tuần)
CREATE TABLE IF NOT EXISTS shift_assignment_logs (
  id          bigserial PRIMARY KEY,
  employee_id text NOT NULL,
  work_date   date NOT NULL,
  shift_code  text NOT NULL,
  action      text NOT NULL,
  source      text NOT NULL DEFAULT 'admin',
  changed_by  text,               -- email người thao tác (NV tự đăng ký thì để trống)
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_logs_emp_date ON shift_assignment_logs (employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_shift_logs_created ON shift_assignment_logs (created_at DESC);
