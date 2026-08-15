-- functions/dine_in.sql — stored function cho Order theo bàn (dine-in).
-- Quy ước: <domain>_<action>, input jsonb (camelCase key), CREATE OR REPLACE (idempotent).
-- Phụ thuộc: bảng dine_in_tables + cột orders.table_id/guest_count/seated_at/left_at
--   (migration 054) và order_get (functions/orders.sql — re-apply cùng lượt boot).

-- ─────────── Serializer: 1 bàn + đơn đang mở (nếu có) ───────────
-- "Đơn đang mở" = table_id khớp, left_at IS NULL, status chưa huỷ/hoàn.
CREATE OR REPLACE FUNCTION dine_in_table_to_json(t dine_in_tables)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',        t.id,
    'name',      t.name,
    'posX',      COALESCE(t.pos_x, 0),
    'posY',      COALESCE(t.pos_y, 0),
    'seats',     COALESCE(t.seats, 4),
    'sortOrder', COALESCE(t.sort_order, 0),
    'active',    COALESCE(t.active, true),
    'currentOrder', (
      SELECT jsonb_build_object(
        'id',            o.id,
        'orderNumber',   o.order_number,
        'guestCount',    o.guest_count,
        'seatedAt',      o.seated_at,
        'leftAt',        o.left_at,
        'total',         COALESCE(o.total, 0),
        'paidAmount',    COALESCE(o.paid_amount, 0),
        'status',        o.status,
        'paymentStatus', o.payment_status,
        'itemCount',     COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0)
      )
      FROM orders o
      WHERE o.table_id = t.id
        AND o.left_at IS NULL
        AND o.status NOT IN ('CANCELLED', 'RETURNED')
      ORDER BY o.order_date DESC NULLS LAST
      LIMIT 1
    )
  );
$$;

-- Danh sách bàn đang hoạt động (kèm đơn đang mở) — sắp theo sort_order rồi tên.
CREATE OR REPLACE FUNCTION dine_in_table_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(dine_in_table_to_json(t) ORDER BY t.sort_order, t.name),
    '[]'::jsonb)
  FROM dine_in_tables t
  WHERE t.active;
$$;

-- Tạo/sửa bàn. p_input: { id?, name?, posX?, posY?, seats?, sortOrder? }.
-- Không có id → tạo mới; có id → cập nhật field được gửi (giữ nguyên field vắng).
CREATE OR REPLACE FUNCTION dine_in_table_upsert(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id text := NULLIF(p_input->>'id', '');
BEGIN
  IF v_id IS NULL THEN
    v_id := replace(gen_random_uuid()::text, '-', '');
    INSERT INTO dine_in_tables (id, name, pos_x, pos_y, seats, sort_order, active, created_at, updated_at)
    VALUES (
      v_id,
      COALESCE(NULLIF(p_input->>'name', ''), 'Bàn'),
      COALESCE(NULLIF(p_input->>'posX', '')::numeric, 0.1),
      COALESCE(NULLIF(p_input->>'posY', '')::numeric, 0.1),
      COALESCE(NULLIF(p_input->>'seats', '')::int, 4),
      COALESCE(NULLIF(p_input->>'sortOrder', '')::int, 0),
      true, now(), now());
  ELSE
    UPDATE dine_in_tables SET
      name       = COALESCE(NULLIF(p_input->>'name', ''), name),
      pos_x      = CASE WHEN p_input ? 'posX'      THEN COALESCE(NULLIF(p_input->>'posX', '')::numeric, pos_x) ELSE pos_x END,
      pos_y      = CASE WHEN p_input ? 'posY'      THEN COALESCE(NULLIF(p_input->>'posY', '')::numeric, pos_y) ELSE pos_y END,
      seats      = CASE WHEN p_input ? 'seats'     THEN COALESCE(NULLIF(p_input->>'seats', '')::int, seats) ELSE seats END,
      sort_order = CASE WHEN p_input ? 'sortOrder' THEN COALESCE(NULLIF(p_input->>'sortOrder', '')::int, sort_order) ELSE sort_order END,
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TABLE_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  RETURN (SELECT dine_in_table_to_json(t) FROM dine_in_tables t WHERE t.id = v_id);
END; $$;

-- Xoá bàn (soft: active=false, giữ FK đơn lịch sử). Chặn khi bàn còn đơn đang mở.
CREATE OR REPLACE FUNCTION dine_in_table_delete(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM orders o
    WHERE o.table_id = p_id AND o.left_at IS NULL
      AND o.status NOT IN ('CANCELLED', 'RETURNED')
  ) THEN
    RAISE EXCEPTION 'TABLE_HAS_OPEN_ORDER' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE dine_in_tables SET active = false, updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- Lịch sử vào/ra của 1 bàn: mọi phiên (đơn gắn table_id), mới nhất trước.
-- Mỗi đơn dine-in = 1 phiên (seated_at → left_at). Trả jsonb array.
CREATE OR REPLACE FUNCTION dine_in_table_history(p_table_id text, p_limit int DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(sub.h ORDER BY sub.seated_at DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT o.seated_at,
      jsonb_build_object(
        'id',            o.id,
        'orderNumber',   o.order_number,
        'seatedAt',      o.seated_at,
        'leftAt',        o.left_at,
        'guestCount',    o.guest_count,
        'total',         COALESCE(o.total, 0),
        'paidAmount',    COALESCE(o.paid_amount, 0),
        'paymentStatus', o.payment_status,
        'status',        o.status,
        'itemCount',     COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0)
      ) AS h
    FROM orders o
    WHERE o.table_id = p_table_id
    ORDER BY o.seated_at DESC NULLS LAST
    LIMIT GREATEST(COALESCE(p_limit, 30), 1)
  ) sub;
$$;

-- Lịch sử vào/ra TOÀN BỘ bàn (kèm tên bàn) — cho tab "Lịch sử bàn". Mới nhất trước.
CREATE OR REPLACE FUNCTION dine_in_history(p_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(sub.h ORDER BY sub.seated_at DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT o.seated_at,
      jsonb_build_object(
        'id',            o.id,
        'orderNumber',   o.order_number,
        'tableId',       o.table_id,
        'tableName',     dt.name,
        'seatedAt',      o.seated_at,
        'leftAt',        o.left_at,
        'guestCount',    o.guest_count,
        'total',         COALESCE(o.total, 0),
        'paidAmount',    COALESCE(o.paid_amount, 0),
        'paymentStatus', o.payment_status,
        'status',        o.status,
        'itemCount',     COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0)
      ) AS h
    FROM orders o
    LEFT JOIN dine_in_tables dt ON dt.id = o.table_id
    WHERE o.table_id IS NOT NULL
    ORDER BY o.seated_at DESC NULLS LAST
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
  ) sub;
$$;

-- Đóng bàn (khách rời): set giờ ra. Trả đơn đã cập nhật (order_get) để FE refresh.
CREATE OR REPLACE FUNCTION dine_in_checkout(p_order_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orders SET left_at = now(), updated_at = now()
  WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN order_get(p_order_id);
END; $$;
