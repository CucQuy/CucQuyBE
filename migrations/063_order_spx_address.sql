-- Làm mịn địa chỉ SPX cho đơn: lưu kết quả resolve Tỉnh/Quận/Xã (danh mục SPX cũ) + trạng thái
-- "đã mịn" ngay trên đơn, để lúc xuất file tạo đơn hàng loạt KHÔNG phải chạy lại AI.
--   spx_state/city/ward: Tỉnh (dạng "HÀ NỘI"/"TP. HỒ CHÍ MINH") + Quận/Huyện + Xã/Phường chuẩn danh mục.
--   spx_status: 'matched' (đủ 3 cấp) | 'partial' (thiếu) | 'unmatched' (chưa khớp).
--   spx_manual: true = user đã sửa tay → auto-resolve KHÔNG ghi đè.
--   spx_source: snapshot địa chỉ gốc (address + city) đã resolve → địa chỉ đổi mới chạy lại.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS spx_state       text,
  ADD COLUMN IF NOT EXISTS spx_city        text,
  ADD COLUMN IF NOT EXISTS spx_ward        text,
  ADD COLUMN IF NOT EXISTS spx_detail      text,
  ADD COLUMN IF NOT EXISTS spx_status      text,
  ADD COLUMN IF NOT EXISTS spx_manual      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spx_source      text,
  ADD COLUMN IF NOT EXISTS spx_resolved_at timestamptz;
