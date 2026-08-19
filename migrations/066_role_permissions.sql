-- Phân quyền theo MODULE + HÀNH ĐỘNG cho mỗi vai trò ("Quyền và Tính năng").
--   permissions: { "orders": {"view":true,"create":true,"edit":true,"delete":false}, ... }
--   Thiếu module/action → coi như KHÔNG có quyền (FE mặc định false, trừ super_admin full).
ALTER TABLE roles ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;
