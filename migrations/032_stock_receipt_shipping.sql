-- Phí vận chuyển trên bill (tách khỏi discount). Bill sàn TMĐT (Shopee/TikTok) hay có
-- "Phí vận chuyển" + "Ưu đãi phí vận chuyển" → total = subtotal + tax + shipping_fee − discount.
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS shipping_fee numeric;
