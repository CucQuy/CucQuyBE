-- MỤC TIÊU DOANH THU dùng chung (2026-09-04).
-- Trước đây màn Mục tiêu lưu trong localStorage → mỗi máy (POS, laptop, điện thoại)
-- một con số khác nhau, không ai biết số nào đúng. Đưa vào DB để cả tiệm thấy chung.
--
-- Bảng 1 dòng (id='goals') như zalo_config / facebook_config.
-- monthly_target: mục tiêu doanh thu CẢ THÁNG; daily_min / daily_expected: mức mỗi ngày.
CREATE TABLE IF NOT EXISTS revenue_goals (
  id               text PRIMARY KEY DEFAULT 'goals',
  monthly_target   numeric NOT NULL DEFAULT 0,
  daily_min        numeric NOT NULL DEFAULT 0,
  daily_expected   numeric NOT NULL DEFAULT 0,
  updated_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO revenue_goals (id) VALUES ('goals') ON CONFLICT (id) DO NOTHING;
