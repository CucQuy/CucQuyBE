-- Option gói cho sản phẩm: mỗi option 1 phí/đơn vị cộng vào giá bậc (vd Đóng gói +2k, Gói hộp+thiệp +6k).
--   products.packaging_options : [{label, perUnit}]
--   order_items.packaging_option : nhãn option đã chọn cho dòng (lưu để hiện lại + báo giá)
ALTER TABLE products    ADD COLUMN IF NOT EXISTS packaging_options jsonb;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS packaging_option  text;
