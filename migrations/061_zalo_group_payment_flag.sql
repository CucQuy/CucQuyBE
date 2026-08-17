-- Mỗi nhóm Zalo có cờ nhận thông báo THANH TOÁN (bên cạnh tạo/sửa/xoá đơn).
-- Routing thanh toán (webhook SePay) gửi vào các nhóm có notify_on_payment = true.
ALTER TABLE zalo_groups ADD COLUMN IF NOT EXISTS notify_on_payment boolean DEFAULT false;
