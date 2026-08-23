-- ============================================================
-- Bổ sung công theo CA cụ thể: thêm shift_code vào attendance_adjustments.
--  * shift_code = 'ca1'|'ca2'|'ca3' → bổ sung cho đúng ca đó (ca sẽ hiển thị xanh).
--  * NULL = bổ sung giờ chung không gắn ca (tương thích dữ liệu cũ).
-- ============================================================
ALTER TABLE attendance_adjustments
  ADD COLUMN IF NOT EXISTS shift_code text;
