-- ============================================================
-- 043 — BOM (Bill of Materials): công thức bánh → nguyên liệu + định lượng.
--
-- Mục tiêu: nối SẢN PHẨM (bánh) ↔ NGUYÊN LIỆU để tính TIÊU HAO thực
--   (Σ số bánh bán × định lượng/bánh) → TỒN DƯ = tổng nhập − tiêu hao.
-- Đây là mắt xích trước đây còn thiếu (recipes cũ chỉ là metadata).
--
-- P1 (file này): schema + SEED 4 công thức cookie từ file công thức của tiệm.
--   qty_per_batch = định lượng cho CẢ MẺ (yield_per_batch bánh); /yield = định lượng/bánh.
--   material_id để NULL — gán ở P2 (mapping tay). ON DELETE SET NULL để không vỡ khi xoá NVL.
-- Idempotent: CREATE TABLE IF NOT EXISTS + reseed (DELETE theo code rồi INSERT).
-- ============================================================

CREATE TABLE IF NOT EXISTS recipe_bom (
  id              text PRIMARY KEY,
  code            text UNIQUE NOT NULL,           -- CK-CC-040
  name            text NOT NULL,                  -- Chocolate Cookie
  yield_per_batch int  NOT NULL DEFAULT 1,        -- 21 bánh/mẻ
  gram_per_piece  numeric,                        -- 40 (g/cái)
  price           numeric,                        -- 10000
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_bom_line (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  recipe_id      text NOT NULL REFERENCES recipe_bom(id) ON DELETE CASCADE,
  section        text NOT NULL DEFAULT 'vo',      -- 'vo' | 'nhan'
  ingredient_raw text NOT NULL,                   -- "Bơ Thái" (tên trong công thức)
  qty_per_batch  numeric NOT NULL,                -- lượng cho cả mẻ
  unit           text NOT NULL,                   -- 'g' | 'ml' | 'qua' | 'goi'
  material_id    text REFERENCES materials(id) ON DELETE SET NULL,  -- gán ở P2
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recipe_bom_line_recipe   ON recipe_bom_line(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_bom_line_material ON recipe_bom_line(material_id) WHERE material_id IS NOT NULL;

-- ── SEED 4 công thức (reseed idempotent theo code) ──────────────────────────
DELETE FROM recipe_bom WHERE code IN ('CK-CC-040','CK-MT-040','CK-RV-040','CK-CF-040');

INSERT INTO recipe_bom (id, code, name, yield_per_batch, gram_per_piece, price) VALUES
  ('CK-CC-040','CK-CC-040','Chocolate Cookie',    21, 40, 10000),
  ('CK-MT-040','CK-MT-040','Matcha Cream Cookie', 21, 40, 10000),
  ('CK-RV-040','CK-RV-040','Red Velvet Cream Cookie', 21, 40, 10000),
  ('CK-CF-040','CK-CF-040','Coffee Cream Cookie', 21, 40, 10000);

INSERT INTO recipe_bom_line (recipe_id, section, ingredient_raw, qty_per_batch, unit) VALUES
  -- Chocolate (CK-CC-040)
  ('CK-CC-040','vo','Bơ Thái',190,'g'),('CK-CC-040','vo','Đường nâu',60,'g'),('CK-CC-040','vo','Đường trắng',47,'g'),
  ('CK-CC-040','vo','Trứng',2,'qua'),('CK-CC-040','vo','Bột mì đa dụng',340,'g'),('CK-CC-040','vo','Baking Soda',1.5,'g'),
  ('CK-CC-040','vo','Baking Powder',1.5,'g'),('CK-CC-040','vo','Bột cacao',20,'g'),
  ('CK-CC-040','nhan','Bột cacao',15,'g'),('CK-CC-040','nhan','Socola đen',20,'g'),('CK-CC-040','nhan','Sữa đặc',52,'g'),
  ('CK-CC-040','nhan','Bơ',20,'g'),('CK-CC-040','nhan','Sữa tươi',5,'ml'),
  -- Matcha (CK-MT-040)
  ('CK-MT-040','vo','Bơ Thái',190,'g'),('CK-MT-040','vo','Đường nâu',60,'g'),('CK-MT-040','vo','Đường trắng',47,'g'),
  ('CK-MT-040','vo','Trứng',2,'qua'),('CK-MT-040','vo','Bột mì đa dụng',340,'g'),('CK-MT-040','vo','Baking Soda',1.5,'g'),
  ('CK-MT-040','vo','Baking Powder',1.5,'g'),('CK-MT-040','vo','Bột Matcha',20,'g'),
  ('CK-MT-040','nhan','Cream cheese',200,'g'),('CK-MT-040','nhan','Sữa đặc',26,'g'),('CK-MT-040','nhan','Đường trắng',10,'g'),
  ('CK-MT-040','nhan','Sữa tươi ít đường',5,'ml'),
  -- Red Velvet (CK-RV-040)
  ('CK-RV-040','vo','Bơ Thái',190,'g'),('CK-RV-040','vo','Đường nâu',60,'g'),('CK-RV-040','vo','Đường trắng',47,'g'),
  ('CK-RV-040','vo','Trứng',2,'qua'),('CK-RV-040','vo','Bột mì đa dụng',340,'g'),('CK-RV-040','vo','Baking Soda',1.5,'g'),
  ('CK-RV-040','vo','Baking Powder',1.5,'g'),('CK-RV-040','vo','Bột cacao',8,'g'),('CK-RV-040','vo','Giấm',2,'ml'),
  ('CK-RV-040','vo','Phẩm màu siêu đỏ',10,'ml'),('CK-RV-040','vo','Vanilla',2,'ml'),('CK-RV-040','vo','Muối',1,'g'),
  ('CK-RV-040','nhan','Cream cheese',200,'g'),('CK-RV-040','nhan','Sữa đặc',26,'g'),('CK-RV-040','nhan','Đường trắng',10,'g'),
  ('CK-RV-040','nhan','Sữa tươi ít đường',5,'ml'),
  -- Coffee (CK-CF-040)
  ('CK-CF-040','vo','Bơ Thái',190,'g'),('CK-CF-040','vo','Đường nâu',60,'g'),('CK-CF-040','vo','Đường trắng',47,'g'),
  ('CK-CF-040','vo','Trứng',2,'qua'),('CK-CF-040','vo','Bột mì đa dụng',340,'g'),('CK-CF-040','vo','Baking Soda',1.5,'g'),
  ('CK-CF-040','vo','Baking Powder',1.5,'g'),('CK-CF-040','vo','Bột cacao',10,'g'),('CK-CF-040','vo','Nescafé 3in1 đỏ',32,'g'),
  ('CK-CF-040','nhan','Cream cheese',200,'g'),('CK-CF-040','nhan','Sữa đặc',26,'g'),('CK-CF-040','nhan','Đường trắng',10,'g'),
  ('CK-CF-040','nhan','Sữa tươi ít đường',5,'ml');
