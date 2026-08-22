-- ============================================================
-- Admin BỔ SUNG CÔNG cho nhân viên: khi NV quên chấm / làm bù / cần chỉnh tay.
--  * Mỗi dòng = số GIỜ bổ sung cho 1 NV trong 1 ngày (có thể âm để trừ bớt).
--  * Giờ bổ sung được cộng vào tổng giờ hợp lệ khi tính lương (payroll_compute),
--    trả công/lương theo mức lương giờ ĐANG áp dụng của vị trí NV ở ngày đó.
--  * Ghi kèm lý do + email người bổ sung để truy vết.
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_adjustments (
  id          text PRIMARY KEY,                                   -- adj_...
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date   date NOT NULL,                                      -- ngày áp dụng
  hours       numeric NOT NULL DEFAULT 0,                         -- giờ bổ sung (âm = trừ)
  reason      text,                                               -- lý do (quên chấm, làm bù…)
  created_by  text,                                               -- email admin bổ sung
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_att_adj_emp_date ON attendance_adjustments(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_att_adj_date ON attendance_adjustments(work_date);
