-- ============================================================
-- Mức lương theo GIỜ cho nhiều VỊ TRÍ, có LỊCH SỬ thay đổi.
--  * Mỗi lần đổi mức = 1 dòng mới (không xoá cũ) → tra được lịch sử.
--  * effective_date: ngày BẮT ĐẦU áp dụng. weekdays: các thứ áp dụng (ISO 1=T2..7=CN)
--    → cho phép lương cuối tuần khác ngày thường.
--  * Mức "đang áp dụng" cho (vị trí, ngày, thứ) = dòng effective_date <= ngày mới nhất
--    mà thứ nằm trong weekdays (hàm wage_rate_effective).
-- ============================================================
CREATE TABLE IF NOT EXISTS wage_rates (
  id             text PRIMARY KEY,
  position       text NOT NULL,                                   -- vị trí (Thợ bánh, Bán hàng…)
  hourly_rate    numeric NOT NULL,                                -- VND / giờ
  weekdays       int[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',        -- thứ áp dụng
  effective_date date NOT NULL,                                   -- ngày bắt đầu áp dụng
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wage_rates_pos_date ON wage_rates(lower(position), effective_date DESC);
