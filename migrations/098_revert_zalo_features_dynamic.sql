-- Hoàn nguyên 097 (chức năng thông báo động / tin tự soạn) — user bỏ hướng này.
-- Về lại mô hình 096: danh mục 12 chức năng hardcode ở code, cờ bật/tắt ở
-- zalo_notify_flags (bảng này CHƯA bị 097 xoá nên không mất trạng thái nào).
--
-- Các function của 097 phải DROP tay: CREATE OR REPLACE ở configurations.sql chỉ
-- ghi lại bản 096 của zalo_features_get/save/zalo_feature_enabled, không xoá hàm mới.
DROP FUNCTION IF EXISTS zalo_feature_render(text, text);
DROP FUNCTION IF EXISTS zalo_feature_upsert(jsonb, text);
DROP FUNCTION IF EXISTS zalo_feature_delete(text);
DROP FUNCTION IF EXISTS zalo_template_vars(text);
DROP FUNCTION IF EXISTS zalo_template_var_list();
DROP FUNCTION IF EXISTS unaccent_vi(text);
DROP FUNCTION IF EXISTS vnd_fmt(numeric);

-- 097 gán thêm feature 'delivery_by_day' cho nhóm nào đang nhận 'delivery_due'.
-- Bản 096 không có key này (lịch delivery_by_day map về 'delivery_due') → dọn cho
-- khỏi để lại dữ liệu chết trong notify_features.
UPDATE zalo_groups
   SET notify_features = array_remove(notify_features, 'delivery_by_day')
 WHERE 'delivery_by_day' = ANY (notify_features);

-- Đồng bộ cờ bật/tắt người dùng đã đổi ở màn Chức năng khi 097 đang chạy (nếu có)
-- về lại zalo_notify_flags trước khi bỏ bảng.
UPDATE zalo_notify_flags fl
   SET enabled = f.enabled, updated_at = now()
  FROM zalo_features f
 WHERE f.feature = fl.feature
   AND f.enabled IS DISTINCT FROM fl.enabled;

DROP TABLE IF EXISTS zalo_features;
