-- ============================================================
-- 103 — Gỡ tính năng GỘP (NCC / NVL) khỏi DB.
--  • stock_receipt_merge_suppliers / _materials: gộp bản trùng vào 1 root — tính năng
--    đã gỡ khỏi FE + BE (không còn endpoint nào gọi) → drop.
--  • stock_receipt_material_merge_suggestions: gợi ý cặp NVL nghi trùng (pg_trgm),
--    chỉ phục vụ màn gợi ý gộp đã gỡ → drop.
-- Định nghĩa cũ đã xoá khỏi functions/stock_receipts.sql; bản backup giữ ngoài repo
-- (info/, gitignored) để dựng lại nếu cần. Không đụng bảng, không mất dữ liệu.
-- ============================================================

DROP FUNCTION IF EXISTS stock_receipt_merge_suppliers(text, jsonb);
DROP FUNCTION IF EXISTS stock_receipt_merge_materials(text, jsonb);
DROP FUNCTION IF EXISTS stock_receipt_material_merge_suggestions(real);
