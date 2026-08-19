-- Cho phép chỉnh ROLE được truy cập mỗi màn ngay ở Cài đặt (không hard-code trong FE routes.ts).
--   roles: mảng role JSON (vd ["admin","staff"]) override route.roles mặc định;
--   NULL = dùng mặc định hard-code ở FE.
ALTER TABLE screen_visibility ADD COLUMN IF NOT EXISTS roles jsonb;

-- Bỏ bản 1-arg cũ để tránh nhập nhằng overload với bản 2-arg (p_map, p_roles) mới.
DROP FUNCTION IF EXISTS screen_visibility_save(jsonb);
