-- ĐVVC 2 dạng: 'express' (truyền thống: SPX/J&T/Viettel…) và 'coach' (gửi xe khách: nhà xe).
--   route:   tuyến chạy (chỉ xe khách, vd "Hà Nội – Sài Gòn").
--   station: bến đỗ / điểm gửi-nhận (chỉ xe khách).
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS type    text NOT NULL DEFAULT 'express',
  ADD COLUMN IF NOT EXISTS route   text,
  ADD COLUMN IF NOT EXISTS station text;
