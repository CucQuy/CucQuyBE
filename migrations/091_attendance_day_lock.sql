-- CHỐT CÔNG theo ngày (2026-09-04).
-- Có ngày nhân viên chỉ xin làm ít giờ (vd xin về sớm, chỉ làm 5h thay vì đủ 2 ca).
-- Ngày đó KHÔNG phải bù cho đủ ca — số giờ đã chấm chính là số giờ cuối cùng.
-- Chốt để: (1) bảng công không coi là "làm thiếu ca", (2) khỏi ai bấm bù đủ ca nữa.
--
-- Chốt KHÔNG ghi lại số giờ (giờ vẫn tính từ chấm công + bổ sung) — chỉ là dấu
-- "ngày này đã xác nhận xong", nên sửa chấm công/bổ sung sau đó vẫn phản ánh đúng.
CREATE TABLE IF NOT EXISTS attendance_day_locks (
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date   date NOT NULL,
  note        text,
  locked_by   text,
  locked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_att_day_locks_date ON attendance_day_locks (work_date);
