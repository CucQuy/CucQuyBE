-- Biến thể vị chi tiết cho sản phẩm: mảng jsonb [{name, image, price}].
-- Mỗi vị có ảnh riêng (tham chiếu ảnh sản phẩm) + giá riêng (tùy chọn).
-- Cột `flavors` (text[]) cũ vẫn giữ = danh sách tên vị (cho màu + tương thích).
ALTER TABLE products ADD COLUMN IF NOT EXISTS flavor_variants jsonb;
