-- ============================================================
-- 074 — Dọn DB object không dùng (dead cleanup).
--  • product_recipe_map (044): bảng map SP→recipe_bom cho tính năng kiểm kê đã GỠ,
--    không hàm/code nào đọc → drop. (DB dựng mới: 044 tạo, 074 này drop.)
--  • 8 stored function 0-caller: định nghĩa đã xoá khỏi functions/*.sql; drop ở đây
--    để DB đang chạy (đã áp trước 074) cũng sạch, idempotent.
-- Read-only về mặt nghiệp vụ: không đụng bảng còn dùng, không mất dữ liệu vận hành.
-- ============================================================

DROP TABLE IF EXISTS product_recipe_map;

DROP FUNCTION IF EXISTS cost_recipe_unit(integer);
DROP FUNCTION IF EXISTS customer_get(text);
DROP FUNCTION IF EXISTS material_recompute_preview();
DROP FUNCTION IF EXISTS material_stocktake_latest();
DROP FUNCTION IF EXISTS payment_account_active();
DROP FUNCTION IF EXISTS product_get(text);
DROP FUNCTION IF EXISTS promotion_get(text);
DROP FUNCTION IF EXISTS receipt_alloc_clear(text);
