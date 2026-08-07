-- ============================================================
-- 044 — Mapping cho BOM (P2). Schema thôi (dữ liệu map là prod-specific,
-- seed riêng vì tham chiếu material_id thực của prod).
--
--  • material_grams_per_unit: quy đổi 1 đơn-vị-kho của NVL = ? gram
--    (để chuẩn hoá cả NHẬP lẫn TIÊU HAO về gram). NULL/không có = không tính tồn theo gram.
--  • product_recipe_map: tên sản phẩm khi BÁN (chuẩn hoá) → công thức (recipe_bom.code).
-- ============================================================

CREATE TABLE IF NOT EXISTS material_grams_per_unit (
  material_id    text PRIMARY KEY REFERENCES materials(id) ON DELETE CASCADE,
  grams_per_unit numeric,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_recipe_map (
  product_name_norm text PRIMARY KEY,   -- unaccent(lower(order_items.product_name))
  recipe_id         text NOT NULL REFERENCES recipe_bom(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now()
);
