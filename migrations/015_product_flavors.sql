-- Thêm thuộc tính "vị" (flavors) cho sản phẩm — mảng text, multi-select.
-- Giống cột tags/gallery (text[]). Không ảnh hưởng giá.
ALTER TABLE products ADD COLUMN IF NOT EXISTS flavors text[];
