-- Gắn ĐVVC vào đơn: đơn ghi nhận "đã gửi qua hãng nào" → thống kê số đơn theo hãng.
--   carrier_id → carriers(id); ON DELETE SET NULL để xoá hãng không làm mất đơn.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier_id text REFERENCES carriers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_carrier_id ON orders(carrier_id);

-- Seed các ĐVVC chuyển phát phổ biến trên thị trường (idempotent theo tên, không đè hãng đã có).
INSERT INTO carriers (id, name, type, sort_order)
SELECT v.id, v.name, 'express', v.so
FROM (VALUES
  ('car_seed_spx',      'Shopee Express (SPX)',        10),
  ('car_seed_jt',       'J&T Express',                 20),
  ('car_seed_ghn',      'Giao Hàng Nhanh (GHN)',       30),
  ('car_seed_ghtk',     'Giao Hàng Tiết Kiệm (GHTK)',  40),
  ('car_seed_viettel',  'Viettel Post',                50),
  ('car_seed_vnpost',   'Vietnam Post (VNPost)',       60),
  ('car_seed_ninjavan', 'Ninja Van',                   70),
  ('car_seed_best',     'BEST Express',                80),
  ('car_seed_ahamove',  'Ahamove',                     90),
  ('car_seed_grab',     'Grab Express',                100)
) AS v(id, name, so)
WHERE NOT EXISTS (SELECT 1 FROM carriers c WHERE lower(c.name) = lower(v.name));

-- Backfill: đơn suy ra SPX (ship tỉnh hoặc mã vận đơn 'SPX…') mà chưa gắn hãng → gắn Shopee Express.
UPDATE orders o
SET carrier_id = (SELECT id FROM carriers WHERE lower(name) = lower('Shopee Express (SPX)') LIMIT 1)
WHERE o.carrier_id IS NULL
  AND (o.delivery_type = 'SHIP_PROVINCE' OR o.tracking_number ~* '^SPX');
