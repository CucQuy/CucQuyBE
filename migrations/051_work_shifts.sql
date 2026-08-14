-- ============================================================
-- Ca làm (work shifts) + phân ca theo ngày (shift_assignments).
--  * work_shifts: định nghĩa ca cố định (seed 3 ca). start/end là giờ trong ngày.
--    cong_factor = 1 ca quy ra bao nhiêu CÔNG (mặc định 0.5 → đủ 2 ca = 1 công) để nối lương sau.
--  * shift_assignments: KẾ HOẠCH ai làm ca nào ngày nào (1 ca nhiều NV, 1 NV nhiều ca/ngày).
-- Khớp CÔNG thực = đối chiếu bảng này với attendance_records (giai đoạn sau).
-- ============================================================

CREATE TABLE IF NOT EXISTS work_shifts (
  code        text PRIMARY KEY,              -- 'ca1' | 'ca2' | 'ca3'
  name        text NOT NULL,                 -- nhãn hiển thị (Ca sáng…)
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  cong_factor numeric NOT NULL DEFAULT 0.5,  -- 1 ca = ? công
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

-- Seed 3 ca cố định (idempotent — không đè nếu đã có).
INSERT INTO work_shifts (code, name, start_time, end_time, cong_factor, sort_order) VALUES
  ('ca1', 'Ca sáng',  '08:00', '12:00', 0.5, 1),
  ('ca2', 'Ca chiều', '13:30', '17:30', 0.5, 2),
  ('ca3', 'Ca tối',   '17:30', '21:30', 0.5, 3)
ON CONFLICT (code) DO NOTHING;

-- Phân ca theo ngày: mỗi dòng = 1 NV được xếp vào 1 ca của 1 ngày.
CREATE TABLE IF NOT EXISTS shift_assignments (
  id          text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date   date NOT NULL,
  shift_code  text NOT NULL REFERENCES work_shifts(code),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date, shift_code)
);
CREATE INDEX IF NOT EXISTS idx_shift_assign_date ON shift_assignments(work_date);
CREATE INDEX IF NOT EXISTS idx_shift_assign_emp ON shift_assignments(employee_id, work_date);
