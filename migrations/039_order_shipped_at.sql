-- Mốc SPX bắt đầu vận chuyển (lần scan sớm nhất) — để tính thời gian giao thực.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
