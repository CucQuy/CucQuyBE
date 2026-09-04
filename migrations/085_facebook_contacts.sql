-- Nối lại Facebook Messenger cho fanpage Tiệm bánh Cúc Quy (2026-09-04).
-- (Bản cũ đã gỡ ở migration 041; lần này thu PSID để GỬI tin, không chỉ đọc.)
--
-- facebook_contacts: mỗi dòng 1 người đã inbox page.
--   psid            : Page-Scoped ID — id khách RIÊNG cho page này, dùng để gửi tin.
--   last_inbound_at : lần cuối KHÁCH nhắn → quyết định còn trong cửa sổ 24h hay không
--                     (Messenger chỉ cho nhắn tự do trong 24h kể từ tin cuối của khách).
--   opted_in_at     : khách đã bấm "Đăng ký nhận tin" (recurring notifications) → gửi
--                     khuyến mãi ngoài 24h mới hợp lệ.
--   customer_id     : nối sang khách hàng trong app (nếu ghép được), có thể NULL.
CREATE TABLE IF NOT EXISTS facebook_contacts (
  psid            text PRIMARY KEY,
  name            text,
  profile_pic     text,
  customer_id     text REFERENCES customers(id) ON DELETE SET NULL,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  message_count   int NOT NULL DEFAULT 0,
  opted_in_at     timestamptz,
  blocked         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_contacts_last_inbound ON facebook_contacts (last_inbound_at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_contacts_customer ON facebook_contacts (customer_id);

-- Tin nhắn (2 chiều) để xem lại hội thoại trong app + biết đã gửi gì cho ai.
CREATE TABLE IF NOT EXISTS facebook_messages (
  id         text PRIMARY KEY,              -- mid của Meta, hoặc uuid cho tin mình gửi
  psid       text NOT NULL REFERENCES facebook_contacts(psid) ON DELETE CASCADE,
  direction  text NOT NULL,                 -- 'in' (khách gửi) | 'out' (page gửi)
  text       text,
  attachments jsonb,
  error      text,                          -- lỗi khi gửi (nếu có)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_messages_psid ON facebook_messages (psid, created_at DESC);
