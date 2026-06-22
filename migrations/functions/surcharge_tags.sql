-- ============================================================
-- Domain: surcharge_tags — tag phụ thu. Toàn bộ logic ở DB, BE chỉ gọi.
-- ============================================================

-- Liệt kê tag phụ thu (sắp theo sort_order, key).
CREATE OR REPLACE FUNCTION surcharge_tag_list()
RETURNS SETOF surcharge_tags
LANGUAGE sql STABLE AS $$
  SELECT * FROM surcharge_tags ORDER BY sort_order, key;
$$;

-- Ghi đè TOÀN BỘ danh sách tag từ JSON client (camelCase): xoá hết rồi insert lại.
-- p_items: jsonb array [{key,label,preset,active,sortOrder}]
-- Tự lọc bản ghi thiếu key/label (validation nằm trong DB). map camel→snake: sortOrder→sort_order.
CREATE OR REPLACE FUNCTION surcharge_tag_save_all(p_items jsonb)
RETURNS SETOF surcharge_tags
LANGUAGE plpgsql AS $$
BEGIN
  -- ghi đè cả list: xoá all rồi insert từ json array
  DELETE FROM surcharge_tags;

  INSERT INTO surcharge_tags (key, label, preset, active, sort_order)
  SELECT
    x->>'key',
    x->>'label',
    COALESCE(NULLIF(x->>'preset','')::numeric, 0),
    COALESCE((x->>'active')::boolean, true),
    COALESCE(NULLIF(x->>'sortOrder','')::int, 0)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS x
  WHERE COALESCE(x->>'key','') <> '' AND COALESCE(x->>'label','') <> '';

  RETURN QUERY SELECT * FROM surcharge_tags ORDER BY sort_order, key;
END;
$$;
