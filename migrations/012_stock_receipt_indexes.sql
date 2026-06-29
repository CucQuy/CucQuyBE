-- ============================================================
-- 012 — Index hỗ trợ tra cứu/dedupe phiếu nhập kho (TICKET 5).
--
-- - suppliers(normalized_name) / materials(normalized_name): resolve khi upsert
--   (stock_receipt_create tìm theo normalized_name) + merge.
-- - stock_receipts(supplier_id) / stock_receipt_lines(material_id): join thống kê.
-- - stock_receipts(bill_hash): chống trùng phiếu OCR.
-- - stock_receipts(created_at): sắp xếp list (ORDER BY created_at DESC).
--
-- Idempotent: CREATE INDEX IF NOT EXISTS.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_suppliers_normalized_name ON suppliers(normalized_name);
CREATE INDEX IF NOT EXISTS idx_materials_normalized_name  ON materials(normalized_name);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_supplier_id ON stock_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_srl_material_id            ON stock_receipt_lines(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_bill_hash   ON stock_receipts(bill_hash);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_created_at  ON stock_receipts(created_at);
