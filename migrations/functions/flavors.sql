-- ============================================================
-- Domain: flavors (vị) — danh sách phẳng có màu. Logic ở DB, BE chỉ gọi.
-- ============================================================

-- Liệt kê vị (sort_order rồi tên).
CREATE OR REPLACE FUNCTION flavor_list()
RETURNS SETOF flavors
LANGUAGE sql STABLE AS $$
  SELECT * FROM flavors ORDER BY sort_order NULLS LAST, name;
$$;

-- Ghi đè toàn bộ danh sách vị từ JSON client (camelCase): upsert mục gửi lên, xoá mục không còn.
-- p_items: jsonb array [{id,name,color,sortOrder}]. Lọc bản ghi thiếu id/name.
CREATE OR REPLACE FUNCTION flavor_save_all(p_items jsonb)
RETURNS SETOF flavors
LANGUAGE plpgsql AS $$
DECLARE
  v_ids text[];
BEGIN
  SELECT array_agg(x->>'id') INTO v_ids
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> '';

  INSERT INTO flavors (id, name, color, sort_order)
  SELECT
    x->>'id',
    x->>'name',
    NULLIF(x->>'color',''),
    COALESCE(NULLIF(x->>'sortOrder','')::int, 0)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> ''
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order;

  IF v_ids IS NULL THEN
    DELETE FROM flavors;
  ELSE
    DELETE FROM flavors WHERE id <> ALL(v_ids);
  END IF;

  RETURN QUERY SELECT * FROM flavors ORDER BY sort_order NULLS LAST, name;
END;
$$;
