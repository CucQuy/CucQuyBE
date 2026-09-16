-- TikTok cho "Kết nối đa kênh" (2026-09-16).
--
-- Khác Facebook/Instagram ở chỗ KHÔNG dùng token dán sẵn trong env được:
-- TikTok chỉ cấp token qua OAuth (access 24h, refresh 365 ngày) và **refresh token ĐỔI
-- sau mỗi lần refresh** → buộc phải có chỗ ghi lại. Vì vậy token nằm ở bảng này,
-- env chỉ giữ client_key/client_secret.
--
-- Tiệm chỉ có 1 tài khoản TikTok nên bảng ép single-row bằng CHECK id = 1.
CREATE TABLE IF NOT EXISTS tiktok_account (
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  open_id            text NOT NULL,
  union_id           text,
  display_name       text NOT NULL DEFAULT '',
  username           text NOT NULL DEFAULT '',
  avatar_url         text,
  profile_url        text,                       -- profile_deep_link (mở app/web TikTok)
  is_verified        boolean NOT NULL DEFAULT false,
  follower_count     bigint  NOT NULL DEFAULT 0,
  following_count    bigint  NOT NULL DEFAULT 0,
  likes_count        bigint  NOT NULL DEFAULT 0,
  video_count        bigint  NOT NULL DEFAULT 0,
  access_token       text NOT NULL,
  refresh_token      text NOT NULL,
  scopes             text[] NOT NULL DEFAULT '{}',
  -- Hết hạn để service biết khi nào phải refresh trước khi gọi API.
  expires_at         timestamptz,
  refresh_expires_at timestamptz,
  connected_by       text,                       -- email người bấm "Nối TikTok"
  synced_at          timestamptz,                -- lần cuối kéo hồ sơ/video về
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Video kéo về từ Display API (/v2/video/list/) — cache để màn Video mở ra là có ngay,
-- không phải gọi TikTok mỗi lần vào màn (rate limit của Display API khá chặt).
CREATE TABLE IF NOT EXISTS tiktok_videos (
  id             text PRIMARY KEY,               -- video id của TikTok
  title          text NOT NULL DEFAULT '',
  description    text NOT NULL DEFAULT '',
  cover_url      text,
  share_url      text,
  embed_link     text,
  duration       int    NOT NULL DEFAULT 0,      -- giây
  view_count     bigint NOT NULL DEFAULT 0,
  like_count     bigint NOT NULL DEFAULT 0,
  comment_count  bigint NOT NULL DEFAULT 0,
  share_count    bigint NOT NULL DEFAULT 0,
  created_time   timestamptz,                    -- lúc đăng trên TikTok
  synced_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_created ON tiktok_videos (created_time DESC);

-- Lần đăng video lên TikTok từ app (Content Posting API).
-- TikTok đăng BẤT ĐỒNG BỘ: init trả `publish_id`, phải hỏi /status/fetch/ mới biết
-- xong hay trượt kiểm duyệt → bảng này là nơi theo dõi, không chỉ là log.
--
-- status: 'draft' | 'scheduled' | 'processing' | 'published' | 'failed'
-- mode:   'direct' (đăng thẳng, cần scope video.publish)
--       | 'inbox'  (đẩy vào hộp nháp của app TikTok để chủ tiệm bấm đăng, scope video.upload)
CREATE TABLE IF NOT EXISTS tiktok_publishes (
  id             text PRIMARY KEY,
  title          text NOT NULL DEFAULT '',
  video_url      text NOT NULL,                  -- URL https công khai, TikTok tự tải về
  mode           text NOT NULL DEFAULT 'inbox',
  privacy_level  text NOT NULL DEFAULT 'SELF_ONLY',
  disable_comment boolean NOT NULL DEFAULT false,
  disable_duet    boolean NOT NULL DEFAULT false,
  disable_stitch  boolean NOT NULL DEFAULT false,
  scheduled_at   timestamptz,                    -- NULL = đăng ngay (app tự cầm hàng đợi)
  status         text NOT NULL DEFAULT 'draft',
  publish_id     text,                           -- mã TikTok trả về để tra trạng thái
  video_id       text,                           -- id video sau khi TikTok đăng xong
  error          text,
  created_by     text,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tiktok_pub_status  ON tiktok_publishes (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tiktok_pub_created ON tiktok_publishes (created_at DESC);
