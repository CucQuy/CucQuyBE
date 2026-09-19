-- ============================================================
-- 105 — Gỡ logic CTV khỏi thông báo Zalo.
--  • zalo_group_members: bảng nối nhóm Zalo ↔ CTV. Mô hình "nhóm có CTV chỉ nhận đơn
--    của CTV đó" đã bỏ — mọi nhóm nhận theo chức năng được gán → drop (prod: 0 dòng).
--  • users.zalo_ctv_group_chat_id: nhóm Zalo riêng của CTV, chỉ do membership sinh ra
--    → drop cột (prod: 0 user có giá trị).
--  • zalo_collaborator_has_group / user_sync_zalo_groups: hết caller sau khi gỡ.
-- Không đụng bảng còn dùng, không mất dữ liệu vận hành.
-- ============================================================

DROP FUNCTION IF EXISTS zalo_collaborator_has_group(text);
DROP FUNCTION IF EXISTS user_sync_zalo_groups(jsonb);

DROP TABLE IF EXISTS zalo_group_members;

ALTER TABLE users DROP COLUMN IF EXISTS zalo_ctv_group_chat_id;
