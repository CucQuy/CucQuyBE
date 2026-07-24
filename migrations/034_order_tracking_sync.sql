-- Đồng bộ vận đơn từ file 3PL (SPX/GHTK/GHN): link tra cứu + trạng thái vận chuyển.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_link   text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_status text;
