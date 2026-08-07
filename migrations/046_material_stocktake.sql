-- ============================================================
-- 046 — Kiểm kê NVL (stocktake): mốc SỰ THẬT để neo tồn kho.
--
-- Tồn = SL đếm tay lúc kiểm kê + nhập SAU kiểm kê − tiêu hao SAU kiểm kê.
-- Chưa kiểm kê NVL nào → tồn = "chưa kiểm kê" (không đoán từ nhập−tiêu hao,
-- vì nhập hay ghi thiếu). Mỗi NVL kiểm kê nhiều lần, lấy lần GẦN NHẤT làm mốc.
-- ============================================================
CREATE TABLE IF NOT EXISTS material_stocktake (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  material_id text NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  count_date  date NOT NULL,
  counted_qty numeric NOT NULL,      -- theo đơn-vị-kho của NVL
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_stocktake_mat ON material_stocktake(material_id, count_date DESC, created_at DESC);
