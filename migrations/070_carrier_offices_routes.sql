-- Nhà xe (coach) có nhiều VĂN PHÒNG (gửi/nhận) + nhiều TUYẾN (giá/giờ riêng).
-- Lưu dạng jsonb array (không thêm bảng) — chỉ dùng cho carrier type='coach'.
--   office: { name?, address, landmark?, phone? }
--   route:  { from, to, price?, departTime?, arriveTime?, note? }
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS offices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS routes  jsonb NOT NULL DEFAULT '[]'::jsonb;
