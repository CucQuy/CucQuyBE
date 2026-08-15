-- Công thức & Giá thành (đa tầng). Idempotent (CREATE OR REPLACE).
-- Xem migrations/057_recipes.sql (schema) + 058_recipes_seed.sql (dữ liệu).
-- Tính cost NVL đệ quy qua bán thành phẩm (child_recipe_id), có chống vòng lặp.

-- NVL cả mẻ (VND) của 1 công thức, đệ quy xuống bán thành phẩm ---------------
CREATE OR REPLACE FUNCTION cost_recipe_batch(p_id integer, p_seen integer[] DEFAULT '{}')
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total numeric := 0;
  r       record;
  v_child numeric;
BEGIN
  IF p_id = ANY (p_seen) THEN
    RETURN 0; -- vòng lặp: dừng an toàn
  END IF;

  FOR r IN SELECT * FROM cost_recipe_lines WHERE recipe_id = p_id LOOP
    IF r.ingredient_id IS NOT NULL THEN
      v_total := v_total + r.qty *
        COALESCE((SELECT unit_price FROM cost_ingredients WHERE id = r.ingredient_id), 0);
    ELSIF r.child_recipe_id IS NOT NULL THEN
      -- chi phí / 1 đơn vị-yield của bán thành phẩm × lượng dùng
      v_child := cost_recipe_batch(r.child_recipe_id, p_seen || p_id)
                 / NULLIF((SELECT yield_qty FROM cost_recipes WHERE id = r.child_recipe_id), 0);
      v_total := v_total + r.qty * COALESCE(v_child, 0);
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

-- Giá thành / đơn vị (VND) ---------------------------------------------------
CREATE OR REPLACE FUNCTION cost_recipe_unit(p_id integer)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT cost_recipe_batch(p_id) / NULLIF((SELECT yield_qty FROM cost_recipes WHERE id = p_id), 0);
$$;

-- Chi tiết cost (jsonb) cho FE ----------------------------------------------
CREATE OR REPLACE FUNCTION recipe_cost_detail(p_id integer)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  r        cost_recipes;
  v_nvl    numeric;
  v_waste  numeric;
  v_total  numeric;
  v_price  numeric;
BEGIN
  SELECT * INTO r FROM cost_recipes WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_nvl   := COALESCE(cost_recipe_batch(p_id) / NULLIF(r.yield_qty, 0), 0);
  v_waste := v_nvl * r.waste_pct;
  v_total := v_nvl + r.packaging_cost + r.labor_cost + r.overhead_cost + v_waste;
  v_price := CASE WHEN r.margin_pct < 1 THEN v_total / (1 - r.margin_pct) ELSE v_total END;

  RETURN jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'kind', r.kind,
    'category', r.category,
    'yieldQty', r.yield_qty,
    'yieldUnit', r.yield_unit,
    'productId', r.product_id,
    'note', r.note,
    'laborTier', r.labor_tier,
    'nvl', round(v_nvl),
    'packaging', round(r.packaging_cost),
    'labor', round(r.labor_cost),
    'overhead', round(r.overhead_cost),
    'wastePct', r.waste_pct,
    'waste', round(v_waste),
    'totalCost', round(v_total),
    'marginPct', r.margin_pct,
    'suggestedPrice', round(v_price),
    'profit', round(v_price - v_total),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'kind', CASE WHEN l.ingredient_id IS NOT NULL THEN 'ingredient' ELSE 'recipe' END,
        'ingredientId', l.ingredient_id,
        'childRecipeId', l.child_recipe_id,
        'name', COALESCE(ci.name, cr.name),
        'qty', l.qty,
        'unit', l.unit,
        'note', l.note,
        'unitCost', CASE
          WHEN l.ingredient_id IS NOT NULL THEN round(ci.unit_price, 2)
          ELSE round(cost_recipe_batch(cr.id) / NULLIF(cr.yield_qty, 0), 2) END,
        'lineCost', round(CASE
          WHEN l.ingredient_id IS NOT NULL THEN l.qty * ci.unit_price
          ELSE l.qty * cost_recipe_batch(cr.id) / NULLIF(cr.yield_qty, 0) END)
      ) ORDER BY l.sort_order, l.id)
      FROM cost_recipe_lines l
      LEFT JOIN cost_ingredients ci ON ci.id = l.ingredient_id
      LEFT JOIN cost_recipes cr     ON cr.id = l.child_recipe_id
      WHERE l.recipe_id = p_id
    ), '[]'::jsonb)
  );
END;
$$;

-- Danh sách công thức + cost (jsonb array) ----------------------------------
CREATE OR REPLACE FUNCTION recipe_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(d ORDER BY d->>'kind' DESC, d->>'category', d->>'name'), '[]'::jsonb)
  FROM (SELECT recipe_cost_detail(id) AS d FROM cost_recipes) s;
$$;

CREATE OR REPLACE FUNCTION recipe_get(p_id integer)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT recipe_cost_detail(p_id);
$$;

-- Tạo/sửa công thức + toàn bộ dòng (save-all) -------------------------------
CREATE OR REPLACE FUNCTION recipe_upsert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id integer;
  ln   jsonb;
  v_i  integer := 0;
BEGIN
  v_id := NULLIF(p->>'id', '')::integer;

  IF v_id IS NULL THEN
    INSERT INTO cost_recipes (name, kind, category, yield_qty, yield_unit, labor_tier,
                              labor_cost, overhead_cost, packaging_cost, waste_pct, margin_pct,
                              product_id, note)
    VALUES (
      p->>'name',
      COALESCE(NULLIF(p->>'kind', ''), 'product'),
      NULLIF(p->>'category', ''),
      COALESCE((p->>'yieldQty')::numeric, 1),
      COALESCE(NULLIF(p->>'yieldUnit', ''), 'cai'),
      NULLIF(p->>'laborTier', ''),
      COALESCE((p->>'laborCost')::numeric, 0),
      COALESCE((p->>'overheadCost')::numeric, 0),
      COALESCE((p->>'packagingCost')::numeric, 0),
      COALESCE((p->>'wastePct')::numeric, 0.05),
      COALESCE((p->>'marginPct')::numeric, 0.4),
      NULLIF(p->>'productId', ''),
      NULLIF(p->>'note', '')
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE cost_recipes SET
      name           = COALESCE(NULLIF(p->>'name', ''), name),
      kind           = COALESCE(NULLIF(p->>'kind', ''), kind),
      category       = NULLIF(p->>'category', ''),
      yield_qty      = COALESCE((p->>'yieldQty')::numeric, yield_qty),
      yield_unit     = COALESCE(NULLIF(p->>'yieldUnit', ''), yield_unit),
      labor_tier     = NULLIF(p->>'laborTier', ''),
      labor_cost     = COALESCE((p->>'laborCost')::numeric, labor_cost),
      overhead_cost  = COALESCE((p->>'overheadCost')::numeric, overhead_cost),
      packaging_cost = COALESCE((p->>'packagingCost')::numeric, packaging_cost),
      waste_pct      = COALESCE((p->>'wastePct')::numeric, waste_pct),
      margin_pct     = COALESCE((p->>'marginPct')::numeric, margin_pct),
      product_id     = NULLIF(p->>'productId', ''),
      note           = NULLIF(p->>'note', ''),
      updated_at     = now()
    WHERE id = v_id;
  END IF;

  -- Thay toàn bộ dòng nếu client gửi mảng 'lines'
  IF p ? 'lines' AND jsonb_typeof(p->'lines') = 'array' THEN
    DELETE FROM cost_recipe_lines WHERE recipe_id = v_id;
    FOR ln IN SELECT * FROM jsonb_array_elements(p->'lines') LOOP
      v_i := v_i + 1;
      INSERT INTO cost_recipe_lines (recipe_id, ingredient_id, child_recipe_id, qty, unit, sort_order, note)
      VALUES (
        v_id,
        NULLIF(ln->>'ingredientId', '')::integer,
        NULLIF(ln->>'childRecipeId', '')::integer,
        COALESCE((ln->>'qty')::numeric, 0),
        COALESCE(NULLIF(ln->>'unit', ''), 'g'),
        COALESCE((ln->>'sortOrder')::integer, v_i),
        NULLIF(ln->>'note', '')
      );
    END LOOP;
  END IF;

  RETURN recipe_cost_detail(v_id);
END;
$$;

-- Chỉnh nhanh mức lợi nhuận -------------------------------------------------
CREATE OR REPLACE FUNCTION recipe_set_margin(p_id integer, p_margin numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cost_recipes
     SET margin_pct = greatest(0, least(0.99, p_margin)), updated_at = now()
   WHERE id = p_id;
  RETURN recipe_cost_detail(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION recipe_delete(p_id integer)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM cost_recipes WHERE id = p_id;
$$;

-- Nguyên liệu costing -------------------------------------------------------
CREATE OR REPLACE FUNCTION ingredient_list()
RETURNS SETOF cost_ingredients LANGUAGE sql STABLE AS $$
  SELECT * FROM cost_ingredients ORDER BY name;
$$;

CREATE OR REPLACE FUNCTION ingredient_upsert(p jsonb)
RETURNS SETOF cost_ingredients LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  v_id := NULLIF(p->>'id', '')::integer;
  IF v_id IS NULL THEN
    INSERT INTO cost_ingredients (name, unit, unit_price, material_id, note)
    VALUES (
      p->>'name',
      COALESCE(NULLIF(p->>'unit', ''), 'g'),
      COALESCE((p->>'unitPrice')::numeric, 0),
      NULLIF(p->>'materialId', ''),
      NULLIF(p->>'note', '')
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE cost_ingredients SET
      name        = COALESCE(NULLIF(p->>'name', ''), name),
      unit        = COALESCE(NULLIF(p->>'unit', ''), unit),
      unit_price  = COALESCE((p->>'unitPrice')::numeric, unit_price),
      material_id = NULLIF(p->>'materialId', ''),
      note        = NULLIF(p->>'note', ''),
      updated_at  = now()
    WHERE id = v_id;
  END IF;
  RETURN QUERY SELECT * FROM cost_ingredients WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION ingredient_delete(p_id integer)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM cost_ingredients WHERE id = p_id;
$$;
