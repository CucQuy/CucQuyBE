-- Gỡ webhook Facebook + data của nó (theo yêu cầu 2026-08-03).
-- Đã gỡ: endpoint POST /webhooks/facebook, handleFacebook(), facebookMessage(),
--        function facebook_message_create (khỏi functions/webhooks.sql).
-- Giữ lại: _mig_fb_order_items / _mig_fb_products (rác import cũ, NGOÀI phạm vi — không đụng).
-- IF EXISTS để idempotent (an toàn nếu chạy lại / DB fresh).

DROP FUNCTION IF EXISTS facebook_message_create(jsonb);
DROP TABLE IF EXISTS facebook_message_attachments;  -- FK → facebook_messages
DROP TABLE IF EXISTS facebook_messages;
