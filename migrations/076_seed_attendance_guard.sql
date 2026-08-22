-- ============================================================
-- 076 — Mặc định BẬT guard mạng cho màn Chấm công (/attendance).
-- Chấm công vốn đã giới hạn theo mạng quán → thể hiện mặc định trên UI toggle mới.
-- ON CONFLICT DO NOTHING: không đè nếu admin đã tự cấu hình.
-- ============================================================

INSERT INTO screen_network_guard (route, enabled)
VALUES ('/attendance', true)
ON CONFLICT (route) DO NOTHING;
