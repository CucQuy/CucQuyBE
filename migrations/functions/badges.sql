-- ============================================================
-- Domain: badges — toàn bộ logic ở DB, BE chỉ gọi.
-- 3 bảng: order_badges, product_badges, customer_badge_rules.
-- API trả 1 object gộp -> RETURNS jsonb.
-- ============================================================

-- Đọc cấu hình badge: gộp 3 bảng thành 1 object, mỗi nhóm sắp theo sort_order.
CREATE OR REPLACE FUNCTION badges_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'orderBadges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'color', color,
        'icon', icon,
        'description', description,
        'sortOrder', COALESCE(sort_order, 0)
      ) ORDER BY COALESCE(sort_order, 0), name)
      FROM order_badges
    ), '[]'::jsonb),
    'productBadges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'color', color,
        'icon', icon,
        'description', description,
        'sortOrder', COALESCE(sort_order, 0)
      ) ORDER BY COALESCE(sort_order, 0), name)
      FROM product_badges
    ), '[]'::jsonb),
    'customerRules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'color', color,
        'icon', icon,
        'ruleType', rule_type,
        'operator', operator,
        'threshold', COALESCE(threshold, 0),
        'description', description,
        'sortOrder', COALESCE(sort_order, 0)
      ) ORDER BY COALESCE(sort_order, 0), name)
      FROM customer_badge_rules
    ), '[]'::jsonb)
  );
$$;

-- Ghi đè toàn bộ cấu hình badge từ JSON client (camelCase).
-- p: {orderBadges:[...], productBadges:[...], customerRules:[...]}.
-- Mỗi nhóm: upsert mục gửi lên, xoá mục không còn (cả 3 trong 1 transaction).
-- Tự lọc bản ghi thiếu id/name (validation nằm trong DB). Trả lại như badges_get().
CREATE OR REPLACE FUNCTION badges_save_all(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_order_items   jsonb := COALESCE(p->'orderBadges', '[]'::jsonb);
  v_product_items jsonb := COALESCE(p->'productBadges', '[]'::jsonb);
  v_rule_items    jsonb := COALESCE(p->'customerRules', '[]'::jsonb);
  v_order_ids   text[];
  v_product_ids text[];
  v_rule_ids    text[];
BEGIN
  -- ── order_badges ──────────────────────────────────────────
  SELECT array_agg(x->>'id') INTO v_order_ids
  FROM jsonb_array_elements(v_order_items) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> '';

  INSERT INTO order_badges (id, name, color, icon, sort_order, description)
  SELECT
    x->>'id',
    x->>'name',
    COALESCE(NULLIF(x->>'color',''), '#64748b'),
    NULLIF(x->>'icon',''),
    COALESCE(NULLIF(x->>'sortOrder','')::int, 0),
    NULLIF(x->>'description','')
  FROM jsonb_array_elements(v_order_items) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> ''
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, color = EXCLUDED.color, icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order, description = EXCLUDED.description;

  IF v_order_ids IS NULL THEN
    DELETE FROM order_badges;
  ELSE
    DELETE FROM order_badges WHERE id <> ALL(v_order_ids);
  END IF;

  -- ── product_badges ────────────────────────────────────────
  SELECT array_agg(x->>'id') INTO v_product_ids
  FROM jsonb_array_elements(v_product_items) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> '';

  INSERT INTO product_badges (id, name, color, icon, sort_order, description)
  SELECT
    x->>'id',
    x->>'name',
    COALESCE(NULLIF(x->>'color',''), '#22c55e'),
    NULLIF(x->>'icon',''),
    COALESCE(NULLIF(x->>'sortOrder','')::int, 0),
    NULLIF(x->>'description','')
  FROM jsonb_array_elements(v_product_items) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> ''
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, color = EXCLUDED.color, icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order, description = EXCLUDED.description;

  IF v_product_ids IS NULL THEN
    DELETE FROM product_badges;
  ELSE
    DELETE FROM product_badges WHERE id <> ALL(v_product_ids);
  END IF;

  -- ── customer_badge_rules ──────────────────────────────────
  SELECT array_agg(x->>'id') INTO v_rule_ids
  FROM jsonb_array_elements(v_rule_items) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> '';

  INSERT INTO customer_badge_rules (id, name, color, icon, rule_type, operator, threshold, sort_order, description)
  SELECT
    x->>'id',
    x->>'name',
    COALESCE(NULLIF(x->>'color',''), '#22c55e'),
    NULLIF(x->>'icon',''),
    CASE WHEN x->>'ruleType' IN ('orderCount','totalSpent','avgOrderValue')
         THEN x->>'ruleType' ELSE 'orderCount' END,
    CASE WHEN x->>'operator' IN ('>=','>','<','<=')
         THEN x->>'operator' ELSE '>=' END,
    COALESCE(NULLIF(x->>'threshold','')::numeric, 0),
    COALESCE(NULLIF(x->>'sortOrder','')::int, 0),
    NULLIF(x->>'description','')
  FROM jsonb_array_elements(v_rule_items) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> ''
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, color = EXCLUDED.color, icon = EXCLUDED.icon,
    rule_type = EXCLUDED.rule_type, operator = EXCLUDED.operator,
    threshold = EXCLUDED.threshold, sort_order = EXCLUDED.sort_order,
    description = EXCLUDED.description;

  IF v_rule_ids IS NULL THEN
    DELETE FROM customer_badge_rules;
  ELSE
    DELETE FROM customer_badge_rules WHERE id <> ALL(v_rule_ids);
  END IF;

  RETURN badges_get();
END;
$$;
