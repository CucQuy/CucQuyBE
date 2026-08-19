-- Vai trò (role) ĐỘNG: quản lý thêm/sửa/xoá ở Cài đặt thay vì cố định trong code.
--   key: định danh lưu ở users.role + screen_visibility.roles (slug a-z0-9_).
--   built_in = true: 4 role gốc, KHÔNG cho xoá (đổi tên hiển thị vẫn được).
CREATE TABLE IF NOT EXISTS roles (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 100,
  built_in    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles (key, name, sort_order, built_in) VALUES
  ('super_admin', 'Super admin',    1, true),
  ('admin',       'Admin',          2, true),
  ('colaborator', 'Cộng tác viên',  3, true),
  ('staff',       'Nhân viên',      4, true)
ON CONFLICT (key) DO NOTHING;
