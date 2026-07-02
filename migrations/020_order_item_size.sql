-- Size đã chọn cho từng dòng đơn (tên size, vd "Combo Gia Đình (5 cái)").
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size text;
