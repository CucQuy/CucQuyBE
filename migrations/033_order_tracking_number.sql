-- Mã vận đơn (cho đơn ship tỉnh / giao qua đơn vị vận chuyển).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text;
