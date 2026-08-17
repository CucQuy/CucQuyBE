-- Tách nhóm Zalo thanh toán khỏi nhóm đơn hàng.
-- payment_group_id: nhóm Zalo nhận thông báo THANH TOÁN (webhook SePay order:paid);
-- main_group_id vẫn là nhóm nhận thông báo ĐƠN HÀNG (tạo/sửa/xoá).
ALTER TABLE zalo_config ADD COLUMN IF NOT EXISTS payment_group_id text;
