-- Thêm "vị" cho từng dòng sản phẩm trong đơn (order_items). Free text theo vị đã chọn lúc bán.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS flavor text;
