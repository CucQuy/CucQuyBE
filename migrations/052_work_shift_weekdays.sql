-- ============================================================
-- Ca làm giờ chỉ là CÀI ĐẶT: thêm "thứ trong tuần áp dụng" (lặp hằng tuần).
-- weekdays: mảng ISO dow 1=T2 .. 7=CN. Mặc định cả 7 ngày.
-- ============================================================
ALTER TABLE work_shifts
  ADD COLUMN IF NOT EXISTS weekdays int[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}';
