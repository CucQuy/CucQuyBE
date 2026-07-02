-- Size (biến thể giá) cho sản phẩm — mảng jsonb [{name, price}]. Giá dòng đơn lấy theo size chọn.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes jsonb;
