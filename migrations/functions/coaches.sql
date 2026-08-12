-- ============================================================
-- Domain: coaches — danh bạ nhà xe. Toàn bộ logic ở DB, BE chỉ gọi.
-- API trả 1 mảng -> RETURNS jsonb. Ghi theo kiểu save-all (giống badges).
-- ============================================================

-- Đọc danh sách nhà xe (sắp theo sort_order rồi tên).
CREATE OR REPLACE FUNCTION coaches_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'phone', phone,
      'route', route,
      'pickupPoint', pickup_point,
      'defaultFee', COALESCE(default_fee, 0),
      'note', note,
      'sortOrder', COALESCE(sort_order, 0)
    ) ORDER BY COALESCE(sort_order, 0), name)
    FROM coaches
  ), '[]'::jsonb);
$$;

-- Ghi đè toàn bộ danh sách nhà xe từ JSON client (camelCase).
-- p = [{id,name,phone,route,pickupPoint,defaultFee,note,sortOrder}, ...].
-- Upsert mục gửi lên, xoá mục không còn (1 transaction). Bỏ bản ghi thiếu id/name.
-- Trả lại như coaches_get().
CREATE OR REPLACE FUNCTION coaches_save_all(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_items jsonb := COALESCE(p, '[]'::jsonb);
  v_ids   text[];
BEGIN
  SELECT array_agg(x->>'id') INTO v_ids
  FROM jsonb_array_elements(v_items) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> '';

  INSERT INTO coaches (id, name, phone, route, pickup_point, default_fee, note, sort_order)
  SELECT
    x->>'id',
    x->>'name',
    NULLIF(x->>'phone',''),
    NULLIF(x->>'route',''),
    NULLIF(x->>'pickupPoint',''),
    COALESCE(NULLIF(x->>'defaultFee','')::numeric, 0),
    NULLIF(x->>'note',''),
    COALESCE(NULLIF(x->>'sortOrder','')::int, 0)
  FROM jsonb_array_elements(v_items) AS x
  WHERE COALESCE(x->>'id','') <> '' AND COALESCE(x->>'name','') <> ''
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, phone = EXCLUDED.phone, route = EXCLUDED.route,
    pickup_point = EXCLUDED.pickup_point, default_fee = EXCLUDED.default_fee,
    note = EXCLUDED.note, sort_order = EXCLUDED.sort_order;

  IF v_ids IS NULL THEN
    DELETE FROM coaches;
  ELSE
    DELETE FROM coaches WHERE id <> ALL(v_ids);
  END IF;

  RETURN coaches_get();
END;
$$;
