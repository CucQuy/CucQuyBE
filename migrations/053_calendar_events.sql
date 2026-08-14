-- ============================================================
-- Sự kiện lịch TỰ THÊM (calendar_events) — 1 trong các nguồn của màn Lịch.
-- Các nguồn khác (đơn theo ngày giao, ca từ setting tuần, chấm công) DERIVE trực tiếp
-- từ bảng sẵn có trong hàm calendar_events_all — không lưu trùng.
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id         text PRIMARY KEY,
  title      text NOT NULL,
  event_date date NOT NULL,
  start_time time,
  end_time   time,
  color      text,            -- gợi ý màu (optional)
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
