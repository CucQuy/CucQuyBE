-- ============================================================
-- 104 — Gỡ HẲN Facebook/Instagram khỏi hệ thống.
-- Kênh này chưa bao giờ dùng thật (chỉ 239 contact + 39 tin nhắn thử nghiệm),
-- FE đã xoá màn + BE đã xoá module facebook → không còn ai đọc/ghi các bảng này.
--
-- Backup TRƯỚC khi chạy: dump 6 bảng (schema + data) + 18 hàm đã lưu ở
-- info/db-dumps/facebook_drop_backup_<ts>.sql (gitignored, ngoài repo).
-- Muốn dựng lại: psql -f file dump đó.
--
-- Hàm đã xoá khỏi functions/facebook.sql (xoá cả file) và functions/orders.sql.
-- ⚠️ MẤT DỮ LIỆU — chỉ chạy sau khi đã có dump.
-- ============================================================

-- ── 18 hàm (chữ ký lấy từ pg_proc trên prod) ──
DROP FUNCTION IF EXISTS facebook_comment_delete(p_id text);
DROP FUNCTION IF EXISTS facebook_comment_get(p_id text);
DROP FUNCTION IF EXISTS facebook_comment_list(p_filter text, p_limit integer, p_offset integer, p_platform text, p_post_id text);
DROP FUNCTION IF EXISTS facebook_comment_mark(p_id text, p_hidden boolean, p_replied boolean, p_auto text);
DROP FUNCTION IF EXISTS facebook_comment_upsert(p_data jsonb);
DROP FUNCTION IF EXISTS facebook_config_get();
DROP FUNCTION IF EXISTS facebook_config_save(p_data jsonb);
DROP FUNCTION IF EXISTS facebook_contact_list(p_filter text, p_limit integer, p_offset integer, p_platform text);
DROP FUNCTION IF EXISTS facebook_contact_upsert(p_data jsonb);
DROP FUNCTION IF EXISTS facebook_message_add(p_data jsonb);
DROP FUNCTION IF EXISTS facebook_message_list(p_psid text, p_limit integer);
DROP FUNCTION IF EXISTS facebook_post_list(p_platform text, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS facebook_post_upsert(p_data jsonb);
DROP FUNCTION IF EXISTS social_post_delete(p_id text);
DROP FUNCTION IF EXISTS social_post_due();
DROP FUNCTION IF EXISTS social_post_list(p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS social_post_mark(p_id text, p_status text, p_remote jsonb, p_error text);
DROP FUNCTION IF EXISTS social_post_save(p_data jsonb);

-- ── Bảng (messages trỏ contacts → xoá con trước; CASCADE cho chắc) ──
DROP TABLE IF EXISTS facebook_messages CASCADE;
DROP TABLE IF EXISTS facebook_comments CASCADE;
DROP TABLE IF EXISTS facebook_posts CASCADE;
DROP TABLE IF EXISTS facebook_contacts CASCADE;
DROP TABLE IF EXISTS facebook_config CASCADE;
DROP TABLE IF EXISTS social_posts CASCADE;
