-- Đăng bài lên fanpage + Instagram TỪ APP (2026-09-04).
-- Soạn 1 lần, chọn đăng ngay hoặc hẹn giờ, gửi lên cả 2 kênh.
--
-- Facebook có hẹn giờ NATIVE (scheduled_publish_time) nhưng Instagram thì KHÔNG,
-- nên bảng này là nguồn sự thật cho hàng đợi: worker tới giờ mới gọi Graph.
-- status: 'draft' | 'scheduled' | 'published' | 'failed'
CREATE TABLE IF NOT EXISTS social_posts (
  id           text PRIMARY KEY,
  message      text NOT NULL DEFAULT '',
  image_url    text,                       -- ảnh https công khai (bắt buộc với Instagram)
  targets      text[] NOT NULL DEFAULT '{facebook}',  -- 'facebook' | 'instagram'
  scheduled_at timestamptz,                -- NULL = đăng ngay
  status       text NOT NULL DEFAULT 'draft',
  -- id bài trên từng kênh sau khi đăng: {"facebook":"...","instagram":"..."}
  remote_ids   jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text,
  created_by   text,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts (created_at DESC);
