-- ============================================================
-- Domain: customers — toàn bộ logic ở DB, BE chỉ gọi.
-- Bảng: customers(id text pk, name text, phone text, created_at timestamptz)
-- ============================================================

-- Liệt kê khách hàng (mới nhất trước).
CREATE OR REPLACE FUNCTION customer_list()
RETURNS SETOF customers
LANGUAGE sql STABLE AS $$
  SELECT * FROM customers ORDER BY created_at DESC NULLS LAST, name;
$$;

-- Lấy 1 khách hàng theo id.
CREATE OR REPLACE FUNCTION customer_get(p_id text)
RETURNS SETOF customers
LANGUAGE sql STABLE AS $$
  SELECT * FROM customers WHERE id = p_id;
$$;

-- Tạo khách hàng mới từ JSON client (camelCase: {name, phone}).
-- Tự sinh id (gen_random_uuid) + created_at = now(). Trả về dòng vừa tạo.
-- Lọc: bỏ qua nếu thiếu name.
CREATE OR REPLACE FUNCTION customer_create(p_data jsonb)
RETURNS SETOF customers
LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
BEGIN
  IF COALESCE(p_data->>'name','') = '' THEN
    RAISE EXCEPTION 'customer name is required';
  END IF;

  v_id := COALESCE(NULLIF(p_data->>'id',''), gen_random_uuid()::text);

  INSERT INTO customers (id, name, phone, created_at)
  VALUES (
    v_id,
    p_data->>'name',
    NULLIF(p_data->>'phone',''),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN QUERY SELECT * FROM customers WHERE id = v_id;
END;
$$;

-- Cập nhật khách hàng theo id từ JSON (camelCase). Chỉ ghi field có mặt trong p_data.
-- Trả về dòng sau cập nhật (rỗng nếu id không tồn tại).
CREATE OR REPLACE FUNCTION customer_update(p_id text, p_data jsonb)
RETURNS SETOF customers
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE customers SET
    name  = CASE WHEN p_data ? 'name'  THEN COALESCE(NULLIF(p_data->>'name',''), name) ELSE name END,
    phone = CASE WHEN p_data ? 'phone' THEN NULLIF(p_data->>'phone','') ELSE phone END
  WHERE id = p_id;

  RETURN QUERY SELECT * FROM customers WHERE id = p_id;
END;
$$;

-- Xoá khách hàng theo id.
CREATE OR REPLACE FUNCTION customer_delete(p_id text)
RETURNS void
LANGUAGE sql AS $$
  DELETE FROM customers WHERE id = p_id;
$$;
