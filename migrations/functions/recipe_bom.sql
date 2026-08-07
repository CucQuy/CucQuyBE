-- ============================================================
-- BOM engine v3 — TỒN DƯ neo theo KIỂM KÊ + BÁNH CÒN LÀM ĐƯỢC.
--
-- Tồn = SL kiểm kê gần nhất + NHẬP sau kiểm kê − TIÊU HAO sau kiểm kê.
-- Chưa kiểm kê → tồn = NULL ("chưa kiểm kê"), KHÔNG đoán từ nhập−tiêu hao.
-- Tiêu hao: cookie đếm từng cái theo order_items.flavors (flavor_recipe_map);
--   "Cúc Quý tốt nghiệp": mỗi cái +1 hộp +1 thiệp +1/60 cuộn dây (gpu hộp/thiệp=1, dây=60).
-- Chuẩn hoá GRAM (grams_per_unit): g/ml→×1; 'qua'/bao bì→×grams_per_unit.
-- Đọc-thuần (STABLE) cho hàm tính; CRUD kiểm kê là hàm ghi. Idempotent.
-- ============================================================

-- ── CRUD kiểm kê ──
CREATE OR REPLACE FUNCTION material_stocktake_upsert(p jsonb)
RETURNS SETOF material_stocktake LANGUAGE plpgsql AS $$
DECLARE v_id text;
BEGIN
  INSERT INTO material_stocktake (material_id, count_date, counted_qty, note)
  VALUES (
    p->>'materialId',
    coalesce((p->>'countDate')::date, current_date),
    greatest(coalesce((p->>'countedQty')::numeric, 0), 0),
    NULLIF(p->>'note','')
  ) RETURNING id INTO v_id;
  RETURN QUERY SELECT * FROM material_stocktake WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION material_stocktake_latest()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_object_agg(material_id, jsonb_build_object('date', count_date, 'qty', counted_qty)), '{}'::jsonb)
  FROM (SELECT DISTINCT ON (material_id) material_id, count_date, counted_qty
        FROM material_stocktake ORDER BY material_id, count_date DESC, created_at DESC) t;
$$;

-- ── Tồn dư ước tính (neo kiểm kê) ──
CREATE OR REPLACE FUNCTION material_stock_estimate()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH stk AS (
    SELECT DISTINCT ON (material_id) material_id, count_date, counted_qty
    FROM material_stocktake ORDER BY material_id, count_date DESC, created_at DESC
  ),
  cookie AS (   -- 1 dòng = 1 cái bánh: recipe + product_name + ngày bán
    SELECT frm.recipe_id, oi.product_name, o.order_date::date AS d
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id AND coalesce(o.is_test,false)=false AND coalesce(o.status,'')<>'CANCELLED'
    CROSS JOIN LATERAL unnest(coalesce(oi.flavors, ARRAY[]::text[])) AS fl
    JOIN flavor_recipe_map frm ON frm.flavor_norm = unaccent(lower(trim(fl)))
  ),
  mat_date AS (   -- tiêu hao (gram) theo (material, ngày): cookie + bao bì
    SELECT l.material_id, c.d,
      sum( (l.qty_per_batch * CASE WHEN l.unit='qua' THEN coalesce(g.grams_per_unit,1) ELSE 1 END)/NULLIF(r.yield_per_batch,0) ) AS grams
    FROM cookie c JOIN recipe_bom r ON r.id=c.recipe_id
    JOIN recipe_bom_line l ON l.recipe_id=r.id AND l.material_id IS NOT NULL
    LEFT JOIN material_grams_per_unit g ON g.material_id=l.material_id
    GROUP BY l.material_id, c.d
    UNION ALL
    SELECT p.material_id, c.d, count(*)::numeric
    FROM cookie c CROSS JOIN (VALUES ('JL6LIHLt9PbyJX6ntyuo'),('pHa1ZAmRPiw8gx2VPGE0'),('XpdZicixs6qo54YqsA9I')) p(material_id)
    WHERE unaccent(lower(c.product_name)) ~ 'tot nghiep' GROUP BY p.material_id, c.d
  ),
  consumed_after AS (
    SELECT md.material_id, sum(md.grams) AS grams
    FROM mat_date md JOIN stk ON stk.material_id=md.material_id
    WHERE md.d >= stk.count_date GROUP BY md.material_id
  ),
  imports_after AS (
    SELECT sl.material_id, sum(coalesce(sl.quantity,0)) AS qty
    FROM stock_receipt_lines sl JOIN stock_receipts sr ON sr.id=sl.receipt_id AND coalesce(sr.status,'')<>'void'
    JOIN stk ON stk.material_id=sl.material_id
    WHERE coalesce(sl.item_type,'material')='material'
      AND coalesce(revenue_try_ts(sl.receipt_date), sl.created_at)::date > stk.count_date
    GROUP BY sl.material_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'materialId', m.id, 'unit', m.canonical_unit, 'gramsPerUnit', g.grams_per_unit,
    'hasStocktake', (stk.material_id IS NOT NULL),
    'stocktakeDate', stk.count_date,
    'stocktakeQty', stk.counted_qty,
    'importedAfter', coalesce(ia.qty, 0),
    'consumedAfter', CASE WHEN stk.material_id IS NULL THEN NULL ELSE round(coalesce(ca.grams,0)/g.grams_per_unit, 2) END,
    'remainingUnit', CASE WHEN stk.material_id IS NULL THEN NULL
        ELSE round(stk.counted_qty + coalesce(ia.qty,0) - coalesce(ca.grams,0)/g.grams_per_unit, 2) END,
    'remainingGrams', CASE WHEN stk.material_id IS NULL THEN NULL
        ELSE round((stk.counted_qty + coalesce(ia.qty,0)) * g.grams_per_unit - coalesce(ca.grams,0), 1) END
  ) ORDER BY m.name), '[]'::jsonb)
  FROM material_grams_per_unit g JOIN materials m ON m.id=g.material_id
  LEFT JOIN stk ON stk.material_id=m.id
  LEFT JOIN consumed_after ca ON ca.material_id=m.id
  LEFT JOIN imports_after ia ON ia.material_id=m.id;
$$;
