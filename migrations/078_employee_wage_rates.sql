-- ============================================================
-- Mức lương/giờ theo TỪNG NHÂN VIÊN (deal riêng), có LỊCH SỬ theo ngày áp dụng.
--  * Tách khỏi "vị trí": nhiều NV cùng vị trí vẫn có mức khác nhau.
--  * Mỗi lần đổi mức = 1 dòng mới (không xoá cũ) → lương tháng CŨ giữ mức cũ.
--  * Mức "đang áp dụng" cho (NV, ngày) = dòng effective_date <= ngày, mới nhất.
--  * Vị trí (employees.position) từ nay chỉ còn là NHÃN phân loại, KHÔNG quyết định lương.
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_wage_rates (
  id             text PRIMARY KEY,                                 -- ewr_...
  employee_id    text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  hourly_rate    numeric NOT NULL,                                 -- VND / giờ
  effective_date date NOT NULL,                                    -- ngày bắt đầu áp dụng
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ewr_emp_date ON employee_wage_rates(employee_id, effective_date DESC);
