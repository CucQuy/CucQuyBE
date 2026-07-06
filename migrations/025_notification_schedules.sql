-- Lịch tự động gửi thông báo Zalo (thay việc bấm tay các tin lặp lại).
-- type: 'daily_summary' (tổng kết hôm nay) | 'production_tomorrow' (sản xuất mai).
-- time_hhmm: giờ VN 'HH:MM'. days: 0..6 (0=CN), rỗng = hằng ngày.
-- last_run_on: 'YYYY-MM-DD' VN đã chạy (chống chạy trùng trong ngày).
CREATE TABLE IF NOT EXISTS notification_schedules (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type             text NOT NULL,
  time_hhmm        text NOT NULL,
  days             int[] NOT NULL DEFAULT '{}',
  target_group_ids text[] NOT NULL DEFAULT '{}',
  enabled          boolean NOT NULL DEFAULT true,
  last_run_on      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
