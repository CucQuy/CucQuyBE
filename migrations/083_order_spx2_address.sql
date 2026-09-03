-- Làm mịn địa chỉ SPX hệ MỚI (2 cấp) cho đơn — song song bộ 3 cấp ở migration 063.
-- Lưu kết quả resolve Tỉnh/Xã (danh mục spx_*_new) ngay trên đơn để lúc xuất file
-- "địa chỉ mới" KHÔNG phải chạy lại AI, và cho sửa tay như bản 3 cấp.
--   spx2_province: Tỉnh/Thành dạng ĐẦY ĐỦ ('Thành phố Hà Nội') — đúng State_list(2) template.
--   spx2_ward:     Xã/Phường theo danh mục mới ('Phường Láng').
--   spx2_status:   'matched' (đủ 2 cấp) | 'partial' (thiếu 1) | 'unmatched'.
--   spx2_manual:   true = user sửa tay → auto-resolve KHÔNG ghi đè.
--   spx2_source:   snapshot địa chỉ gốc đã resolve → địa chỉ đổi thì chạy lại.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS spx2_province    text,
  ADD COLUMN IF NOT EXISTS spx2_ward        text,
  ADD COLUMN IF NOT EXISTS spx2_status      text,
  ADD COLUMN IF NOT EXISTS spx2_manual      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spx2_source      text,
  ADD COLUMN IF NOT EXISTS spx2_resolved_at timestamptz;
