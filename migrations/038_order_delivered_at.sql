-- ============================================================
-- 038 — Lưu MỐC GIAO THÀNH CÔNG (SPX code F980) để phân tích thời gian giao.
--   delivered_at timestamptz — thời điểm SPX giao thành công (từ tracking).
-- So với orders.delivery_date (ngày cần giao) → tính đơn giao sớm/đúng/trễ mấy ngày.
-- Idempotent.
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
