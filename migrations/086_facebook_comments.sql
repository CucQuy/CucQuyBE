-- Quản lý BÌNH LUẬN fanpage (xem / trả lời / ẩn / xoá + tự động hoá).
-- Abit không có API cho phần này (webhook của họ chỉ đẩy comment, không ẩn/trả lời được)
-- nên làm thẳng với Graph API như phần tin nhắn.
--
-- facebook_posts   : cache bài đăng để nhóm bình luận theo bài.
-- facebook_comments: mỗi dòng 1 bình luận; is_hidden/replied_at để biết đã xử lý chưa.
-- facebook_config  : bật/tắt các luật tự động (bảng 1 dòng, giống zalo_config).
CREATE TABLE IF NOT EXISTS facebook_posts (
  id           text PRIMARY KEY,          -- '{page-id}_{post-id}' như Graph trả về
  message      text,
  permalink    text,
  created_time timestamptz,
  synced_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facebook_comments (
  id           text PRIMARY KEY,          -- id bình luận của Meta
  post_id      text,
  parent_id    text,                      -- bình luận cha (nếu là reply)
  psid         text,                      -- id người bình luận (page-scoped)
  from_name    text,
  message      text,
  is_hidden    boolean NOT NULL DEFAULT false,
  hidden_at    timestamptz,
  replied_at   timestamptz,
  auto_action  text,                      -- luật tự động đã chạy: 'hide_phone' | 'hide_keyword' | 'reply' | 'private_reply'
  created_time timestamptz,
  raw          jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_comments_post ON facebook_comments (post_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_fb_comments_created ON facebook_comments (created_time DESC);

CREATE TABLE IF NOT EXISTS facebook_config (
  id                  text PRIMARY KEY DEFAULT 'fb',
  -- Tự ẩn bình luận có SĐT (khách để lại số → đối thủ hốt data).
  auto_hide_phone     boolean NOT NULL DEFAULT false,
  -- Tự ẩn theo từ khoá (spam, tên shop đối thủ…).
  auto_hide_keywords  text[]  NOT NULL DEFAULT '{}',
  -- Tự trả lời công khai câu mẫu dưới bình luận mới.
  auto_reply_enabled  boolean NOT NULL DEFAULT false,
  auto_reply_text     text,
  -- Tự nhắn RIÊNG người bình luận → mở cửa sổ 24h để bán tiếp (giá trị lớn nhất).
  auto_private_reply  boolean NOT NULL DEFAULT false,
  private_reply_text  text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO facebook_config (id) VALUES ('fb') ON CONFLICT (id) DO NOTHING;
