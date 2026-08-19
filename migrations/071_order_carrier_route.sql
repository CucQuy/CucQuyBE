-- Đơn gửi qua nhà xe (coach) ghi thêm ĐI TUYẾN NÀO (text, vd "Huế → Hải Phòng").
-- Cho phép liệt kê / chọn đơn theo tuyến trong view Nhà xe.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_route text;
