-- Đơn gửi nhà xe (coach) chọn thêm VĂN PHÒNG NHẬN (điểm khách lấy hàng ở đầu đến).
-- text = tên VP (vd "VP1 Hà Nội"); danh sách VP lấy từ carriers.offices.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_office text;
