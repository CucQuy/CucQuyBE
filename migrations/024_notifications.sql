-- Nhật ký & hộp thư thông báo: mỗi lần gửi Zalo (sent/failed) hoặc sự kiện in-app 1 dòng.
-- kind = 'zalo' (outbound, có payload để gửi lại) | 'inapp' (hộp thư, read_at = đã đọc).
CREATE TABLE IF NOT EXISTS notifications (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind         text NOT NULL,                 -- 'zalo' | 'inapp'
  category     text,                           -- 'order_paid'|'custom'|'unpaid'|... (phân loại)
  title        text,
  body         text,
  target       text,                           -- nhóm Zalo (id/tên) hoặc 'admins'
  status       text NOT NULL DEFAULT 'sent',   -- 'sent'|'failed'|'pending'
  error        text,                           -- lý do khi failed
  payload      jsonb,                          -- payload gốc để gửi lại (Zalo)
  triggered_by text,                           -- uid/email người kích hoạt, hoặc 'system'
  read_at      timestamptz,                    -- in-app: null = chưa đọc
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_inapp ON notifications (kind, read_at, created_at DESC);
