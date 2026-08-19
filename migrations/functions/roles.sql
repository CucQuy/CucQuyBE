-- ============================================================
-- Domain: roles — vai trò động (CRUD ở Cài đặt). Trả jsonb camelCase.
-- ============================================================

CREATE OR REPLACE FUNCTION role_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'key', key, 'name', name, 'sortOrder', sort_order, 'builtIn', built_in
    ) ORDER BY sort_order, name),
    '[]'::jsonb)
  FROM roles;
$$;

-- Thêm/sửa 1 role. key mới → slug hoá (a-z0-9_); key đã có → chỉ đổi name/sort_order.
-- p: { key, name, sortOrder? }. built_in giữ nguyên (không cho đổi qua đây).
CREATE OR REPLACE FUNCTION role_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  -- slug: bỏ dấu (unaccent) → thường hoá → ký tự lạ thành '_' → cắt '_' đầu/cuối.
  v_key  text := trim(both '_' FROM lower(regexp_replace(
                   unaccent(trim(COALESCE(NULLIF(p->>'key',''), p->>'name', ''))),
                   '[^a-zA-Z0-9_]+', '_', 'g')));
  v_name text := trim(COALESCE(p->>'name',''));
  v_sort int  := COALESCE(NULLIF(p->>'sortOrder','')::int, 100);
BEGIN
  IF v_key = '' OR v_name = '' THEN
    RAISE EXCEPTION 'Thiếu key/name vai trò';
  END IF;
  INSERT INTO roles (key, name, sort_order, built_in)
  VALUES (v_key, v_name, v_sort, false)
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        sort_order = COALESCE(NULLIF(p->>'sortOrder','')::int, roles.sort_order);
  RETURN role_list();
END;
$$;

-- Xoá 1 role: chặn role gốc (built_in) và role đang có user dùng.
CREATE OR REPLACE FUNCTION role_delete(p_key text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM roles WHERE key = p_key AND built_in) THEN
    RAISE EXCEPTION 'ROLE_BUILTIN';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE role = p_key) THEN
    RAISE EXCEPTION 'ROLE_IN_USE';
  END IF;
  DELETE FROM roles WHERE key = p_key;
  RETURN role_list();
END;
$$;
