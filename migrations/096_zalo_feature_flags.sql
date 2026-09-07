-- Công tắc BẬT/TẮT từng chức năng thông báo Zalo (màn "Chức năng").
--
-- Khác với zalo_groups.notify_features (095 — nhóm NÀO nhận): bảng này là cờ tổng,
-- tắt là không gửi kể cả nhóm đã được gán. Cần vì có lúc muốn im 1 loại thông báo
-- (vd tổng kết ngày, health check) mà không phải đi bỏ gán ở từng nhóm rồi gán lại.
CREATE TABLE IF NOT EXISTS zalo_notify_flags (
  feature    text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Seed đúng 12 chức năng đang có (ZALO_NOTIFY_FEATURES ở BE). Mặc định BẬT hết để
-- hành vi không đổi sau khi deploy. Chức năng chưa có hàng nào cũng coi như bật.
INSERT INTO zalo_notify_flags (feature, enabled)
SELECT x, true
  FROM unnest(ARRAY[
         'order_create', 'order_update', 'order_delete', 'payment',
         'unpaid', 'pending', 'delivery_due', 'production_tomorrow',
         'stuck_pending', 'daily_summary', 'custom', 'health_check'
       ]) AS x
ON CONFLICT (feature) DO NOTHING;
