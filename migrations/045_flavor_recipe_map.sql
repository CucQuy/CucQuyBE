-- ============================================================
-- 045 — flavor_recipe_map: tên VỊ khi bán (order_items.flavors) → công thức.
-- Vì cookie bán nhiều cái/đơn, mỗi cái 1 vị lưu trong mảng flavors → phải đếm
-- từng cái theo vị. Seed map là prod-specific (recipe id), áp qua db_apply_sql.
-- ============================================================
CREATE TABLE IF NOT EXISTS flavor_recipe_map (
  flavor_norm text PRIMARY KEY,   -- unaccent(lower(trim(flavor)))
  recipe_id   text NOT NULL REFERENCES recipe_bom(id) ON DELETE CASCADE
);
