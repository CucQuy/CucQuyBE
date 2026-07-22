-- Phân loại sản phẩm + giá bậc theo SL + add-on tự thêm (mô hình "mọi thứ là sản phẩm").
--   type            : 'cake' | 'packaging' | 'decoration' | 'accessory' | 'service' (NULL = cake mặc định)
--   price_tiers     : [{minQty, price}] — giá/đơn vị khi tổng SL sản phẩm >= minQty (bậc cao nhất khớp)
--   add_on_product_ids : [productId] — SP tự thêm vào đơn (qty đồng bộ) khi SP này được chọn (phụ phí gói)
ALTER TABLE products ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_tiers jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS add_on_product_ids jsonb;
