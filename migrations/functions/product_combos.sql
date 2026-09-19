-- ============================================================
-- Domain: product_combos — combo = danh sách sản phẩm có sẵn (bảng product_combo_items).
-- Xem migrations/102_product_combo_items.sql (schema).
-- Giá lẻ 1 phần = products.price * portion; "khách tiết kiệm" = tổng lẻ - giá combo.
-- ============================================================

-- Chi tiết 1 combo: header + các món + đối chiếu giá lẻ ------------------------
CREATE OR REPLACE FUNCTION product_combo_get(p_combo_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  c          products%ROWTYPE;
  v_items    jsonb;
  v_retail   numeric;
BEGIN
  SELECT * INTO c FROM products WHERE id = p_combo_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sortOrder')::int), '[]'::jsonb),
         COALESCE(sum((x->>'lineRetail')::numeric), 0)
    INTO v_items, v_retail
  FROM (
    SELECT jsonb_build_object(
             'id',          i.id,
             'productId',   p.id,
             'name',        p.name,
             'qty',         i.qty,
             'portion',     i.portion,
             'unitLabel',   i.unit_label,
             'sortOrder',   i.sort_order,
             'note',        i.note,
             'unitRetail',  round(COALESCE(p.price, 0) * i.portion),
             'lineRetail',  round(COALESCE(p.price, 0) * i.portion * i.qty),
             'unitCost',    round(COALESCE(p.cost_price, 0) * i.portion),
             'lineCost',    round(COALESCE(p.cost_price, 0) * i.portion * i.qty)
           ) AS x
    FROM product_combo_items i
    JOIN products p ON p.id = i.item_id
    WHERE i.combo_id = p_combo_id
  ) s;

  RETURN jsonb_build_object(
    'comboId',    c.id,
    'name',       c.name,
    'price',      c.price,
    'costPrice',  c.cost_price,
    'status',     c.status,
    'itemCount',  (SELECT COALESCE(sum(qty), 0) FROM product_combo_items WHERE combo_id = c.id),
    'retailSum',  round(v_retail),
    'saving',     round(v_retail - COALESCE(c.price, 0)),
    'savingPct',  CASE WHEN v_retail > 0
                       THEN round((v_retail - COALESCE(c.price, 0)) / v_retail * 100)
                       ELSE 0 END,
    'items',      v_items
  );
END;
$$;

-- Tất cả combo (SP có ít nhất 1 dòng thành phần) -----------------------------
CREATE OR REPLACE FUNCTION product_combo_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(product_combo_get(id) ORDER BY price), '[]'::jsonb)
  FROM products
  WHERE id IN (SELECT DISTINCT combo_id FROM product_combo_items);
$$;

-- Ghi đè toàn bộ thành phần của 1 combo --------------------------------------
-- p_items: [{ "productId": "...", "qty": 2, "portion": 0.1, "unitLabel": "viên", "note": null }]
CREATE OR REPLACE FUNCTION product_combo_save(p_combo_id text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_combo_id) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  DELETE FROM product_combo_items WHERE combo_id = p_combo_id;

  INSERT INTO product_combo_items (combo_id, item_id, qty, portion, unit_label, sort_order, note)
  SELECT p_combo_id,
         e->>'productId',
         COALESCE(NULLIF(e->>'qty', '')::numeric, 1),
         COALESCE(NULLIF(e->>'portion', '')::numeric, 1),
         NULLIF(e->>'unitLabel', ''),
         ord::int,
         NULLIF(e->>'note', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY AS a(e, ord)
  WHERE NULLIF(e->>'productId', '') IS NOT NULL;

  RETURN product_combo_get(p_combo_id);
END;
$$;
