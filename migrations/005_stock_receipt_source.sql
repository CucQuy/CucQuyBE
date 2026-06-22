-- ============================================================
-- 005 — Nguồn phiếu nhập kho (issue #35).
-- Thêm cột stock_receipts.source: 'ocr' | 'manual'.
--   'ocr'    — phiếu tạo từ luồng OCR ảnh bill (mặc định, no-regression đơn cũ).
--   'manual' — phiếu nhập THỦ CÔNG qua form (bill viết tay OCR không đọc được).
-- Dùng để bỏ chống trùng DUPLICATE_BILL cho phiếu manual (xem functions/stock_receipts.sql):
--   bill_hash của phiếu tay (ocrText rỗng) dễ trùng oan khi cùng NCC+ngày+tổng.
-- Idempotent: ADD COLUMN IF NOT EXISTS, default 'ocr' nên mọi phiếu cũ tự gắn 'ocr'.
-- ============================================================
ALTER TABLE stock_receipts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ocr';
