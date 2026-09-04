-- Gộp INSTAGRAM vào chung hạ tầng Facebook (2026-09-04).
-- Tài khoản IG @tiembanhcucquy đã nối sẵn với fanpage nên dùng CHUNG page token:
-- bình luận / inbox / bài đăng của IG đi qua đúng các bảng facebook_* sẵn có,
-- chỉ thêm cột `platform` để phân biệt nguồn khi hiển thị và khi gọi Graph API
-- (đường dẫn ẩn/trả lời của IG khác Facebook).
--
-- 'facebook' | 'instagram' — mặc định 'facebook' để dữ liệu cũ giữ nguyên ý nghĩa.
ALTER TABLE facebook_posts    ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'facebook';
ALTER TABLE facebook_comments ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'facebook';
ALTER TABLE facebook_contacts ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'facebook';

-- Ảnh/link bài để hiện thumbnail bên cạnh bình luận (IG là mạng ảnh, thiếu ảnh rất khó nhìn).
ALTER TABLE facebook_posts ADD COLUMN IF NOT EXISTS media_url  text;
ALTER TABLE facebook_posts ADD COLUMN IF NOT EXISTS media_type text;

CREATE INDEX IF NOT EXISTS idx_fb_comments_platform ON facebook_comments (platform, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_fb_contacts_platform ON facebook_contacts (platform, last_inbound_at DESC);

-- Bỏ bản 3 tham số cũ: bản mới thêm p_platform có DEFAULT, để cả hai sẽ "function is not unique".
DROP FUNCTION IF EXISTS facebook_comment_list(text, int, int);

DROP FUNCTION IF EXISTS facebook_contact_list(text, int, int);
