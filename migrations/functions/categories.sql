-- ============================================================
-- Domain: categories — toàn bộ logic ở DB, BE chỉ gọi.
-- ============================================================

-- Liệt kê danh mục (đã sắp xếp cây).
CREATE OR REPLACE FUNCTION category_list()
RETURNS SETOF categories
LANGUAGE sql STABLE AS $$
  SELECT * FROM categories ORDER BY parent_id NULLS FIRST, sort_order, name;
$$;

-- Ghi đè toàn bộ danh mục từ JSON client (camelCase): upsert mục gửi lên, xoá mục không còn.
-- p_items: jsonb array [{id,name,parentId,icon,color,sortOrder,description}]
-- Tự lọc bản ghi thiếu id/name (validation nằm trong DB).
CREATE OR REPLACE FUNCTION category_save_all(p_items jsonb)
RETURNS SETOF categories
LANGUAGE plpgsql AS $$
DECLARE
  v_ids text[];
BEGIN
  -- danh sách id hợp lệ gửi lên
  SELECT array_agg(x->>'id') INTO v_ids
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> '';

  -- upsert
  INSERT INTO categories (id, name, parent_id, icon, color, sort_order, description)
  SELECT
    x->>'id',
    x->>'name',
    NULLIF(x->>'parentId',''),
    NULLIF(x->>'icon',''),
    NULLIF(x->>'color',''),
    COALESCE(NULLIF(x->>'sortOrder','')::int, 0),
    NULLIF(x->>'description','')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> ''
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, icon = EXCLUDED.icon,
    color = EXCLUDED.color, sort_order = EXCLUDED.sort_order, description = EXCLUDED.description;

  -- xoá mục không còn trong danh sách
  IF v_ids IS NULL THEN
    DELETE FROM categories;
  ELSE
    DELETE FROM categories WHERE id <> ALL(v_ids);
  END IF;

  RETURN QUERY SELECT * FROM categories ORDER BY parent_id NULLS FIRST, sort_order, name;
END;
$$;
