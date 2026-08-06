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

-- ============================================================
-- Phân tích KHÁCH HÀNG (tách từ analytics_overview cũ). Read-only, STABLE.
-- Tính trên đơn KHÔNG test + KHÔNG huỷ, lọc order_date (p_from/p_to NULL = toàn bộ).
-- Trả { customers: {total,returning,newCount,top[]}, receivables: {count,remaining,aging,orders[]} }.
-- ============================================================
CREATE OR REPLACE FUNCTION customer_analytics(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH valid AS (
    SELECT * FROM orders
    WHERE COALESCE(is_test, false) = false
      AND COALESCE(status, '') <> 'CANCELLED'
      AND (p_from IS NULL OR order_date >= p_from)
      AND (p_to   IS NULL OR order_date <  (p_to + 1))
  )
  SELECT jsonb_build_object(
    -- Khách hàng: mới vs quay lại + top khách theo doanh thu.
    'customers', (
      WITH c AS (
        SELECT lower(btrim(customer_name)) AS k, max(customer_name) AS name,
               count(*) AS orders, COALESCE(sum(total),0) AS revenue, max(order_date) AS last_order
        FROM valid WHERE COALESCE(customer_name,'')<>'' GROUP BY 1
      )
      SELECT jsonb_build_object(
        'total', (SELECT count(*) FROM c),
        'returning', (SELECT count(*) FROM c WHERE orders>=2),
        'newCount', (SELECT count(*) FROM c WHERE orders=1),
        'top', (SELECT COALESCE(jsonb_agg(x ORDER BY x.revenue DESC),'[]'::jsonb) FROM (
          SELECT name, orders, revenue, last_order FROM c ORDER BY revenue DESC LIMIT 12) x)
      )
    ),
    -- Công nợ: đơn chưa thu đủ + phân tuổi nợ + danh sách.
    'receivables', (
      WITH r AS (
        SELECT order_number, customer_name, total, paid_amount,
               (total - paid_amount) AS remaining, order_date,
               (CURRENT_DATE - order_date::date) AS age_days, payment_status
        FROM valid WHERE paid_amount < total
      )
      SELECT jsonb_build_object(
        'count', (SELECT count(*) FROM r),
        'remaining', (SELECT COALESCE(sum(remaining),0) FROM r),
        'aging', jsonb_build_object(
          'd0_7',  (SELECT count(*) FROM r WHERE age_days BETWEEN 0 AND 7),
          'd8_14', (SELECT count(*) FROM r WHERE age_days BETWEEN 8 AND 14),
          'd15_30',(SELECT count(*) FROM r WHERE age_days BETWEEN 15 AND 30),
          'd30p',  (SELECT count(*) FROM r WHERE age_days > 30)),
        'orders', (SELECT COALESCE(jsonb_agg(x ORDER BY x.age_days DESC),'[]'::jsonb) FROM (
          SELECT order_number, customer_name, total, paid_amount, remaining, age_days, payment_status
          FROM r ORDER BY age_days DESC LIMIT 40) x)
      )
    ),
    'generatedAt', now()
  );
$$;
