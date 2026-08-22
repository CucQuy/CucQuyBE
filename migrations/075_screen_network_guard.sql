-- ============================================================
-- 075 — Guard theo MẠNG cho từng màn hình (mở rộng từ giới hạn IP chấm công).
-- Dùng CHUNG danh sách dải mạng cho phép ở bảng attendance_allowed_networks
-- (không đổi tên để tránh rủi ro — coi như "danh sách mạng hệ thống").
-- Bảng này chỉ lưu: màn hình (route) nào YÊU CẦU phải ở mạng được duyệt.
-- ============================================================

CREATE TABLE IF NOT EXISTS screen_network_guard (
  route   text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true
);
