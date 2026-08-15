-- 057: Module Công thức & Giá thành (bánh + cookie + nước), BOM ĐA TẦNG.
-- ============================================================================
-- Giá thành/đơn-vị-bán = NVL(giá max, đệ quy qua bán thành phẩm)
--                       + bao bì + công + vận hành/khấu hao + hao hụt(%NVL)
-- Giá bán gợi ý = giá thành / (1 - margin_pct)  (margin_pct chọn riêng mỗi SP)
-- ----------------------------------------------------------------------------
--  cost_ingredients   : NVL dùng cho costing (đơn giá theo ĐÚNG đơn vị dùng);
--                       material_id link tùy chọn tới materials để lấy giá nhập.
--  cost_recipes       : 1 công thức = 'product' (bán) hoặc 'semi' (bán thành phẩm)
--  cost_recipe_lines  : 1 dòng trỏ ingredient HOẶC child_recipe (đa tầng)
--  Hàm tính cost đệ quy nằm ở migrations/functions/recipes.sql
-- ============================================================================

-- Nguyên liệu cho costing --------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_ingredients (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  unit        text NOT NULL,                     -- đơn vị dùng: g|ml|qua|lat|muong|goi|cai
  unit_price  numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0), -- VND / unit (giá max)
  material_id text REFERENCES materials(id) ON DELETE SET NULL,   -- link kho (tùy chọn)
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Công thức ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_recipes (
  id             serial PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  kind           text NOT NULL DEFAULT 'product',        -- 'product' | 'semi'
  category       text,                                   -- 'cake'|'cookie'|'drink'|null
  yield_qty      numeric NOT NULL DEFAULT 1 CHECK (yield_qty > 0), -- số đơn vị ra / mẻ
  yield_unit     text NOT NULL DEFAULT 'cai',            -- cai|lat|ly|ml|g|set
  labor_tier     text,                                   -- 'easy'|'medium'|'hard' (nhãn)
  labor_cost     numeric NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),     -- VND / đơn vị (công)
  overhead_cost  numeric NOT NULL DEFAULT 0 CHECK (overhead_cost >= 0),  -- VND / đơn vị (vận hành/khấu hao)
  packaging_cost numeric NOT NULL DEFAULT 0 CHECK (packaging_cost >= 0), -- VND / đơn vị (bao bì)
  waste_pct      numeric NOT NULL DEFAULT 0.05 CHECK (waste_pct >= 0 AND waste_pct < 1), -- hao hụt
  margin_pct     numeric NOT NULL DEFAULT 0.4  CHECK (margin_pct >= 0 AND margin_pct < 1), -- lợi nhuận chọn
  product_id     text REFERENCES products(id) ON DELETE SET NULL,       -- gắn SP bán (tùy chọn)
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Dòng công thức: ingredient HOẶC recipe con -------------------------------
CREATE TABLE IF NOT EXISTS cost_recipe_lines (
  id              serial PRIMARY KEY,
  recipe_id       integer NOT NULL REFERENCES cost_recipes(id) ON DELETE CASCADE,
  ingredient_id   integer REFERENCES cost_ingredients(id) ON DELETE RESTRICT,
  child_recipe_id integer REFERENCES cost_recipes(id) ON DELETE RESTRICT,
  qty             numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),  -- lượng dùng cho CẢ MẺ
  unit            text NOT NULL DEFAULT 'g',                    -- đơn vị của qty (khớp ingredient.unit / child.yield_unit)
  sort_order      integer NOT NULL DEFAULT 0,
  note            text,
  CHECK (ingredient_id IS NOT NULL OR child_recipe_id IS NOT NULL),
  CHECK (child_recipe_id IS NULL OR child_recipe_id <> recipe_id)  -- không tự trỏ mình
);

CREATE INDEX IF NOT EXISTS idx_cost_recipe_lines_recipe ON cost_recipe_lines(recipe_id);
CREATE INDEX IF NOT EXISTS idx_cost_recipe_lines_child  ON cost_recipe_lines(child_recipe_id);
CREATE INDEX IF NOT EXISTS idx_cost_recipes_product     ON cost_recipes(product_id);
