-- ============================================================
-- Lịch tự động gửi thông báo Zalo. Cron (BE) gọi due() mỗi phút → compose → gửi → mark.
-- ============================================================

CREATE OR REPLACE FUNCTION notification_schedule_to_json(s notification_schedules)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', s.id,
    'type', s.type,
    'timeHHMM', s.time_hhmm,
    'days', to_jsonb(s.days),
    'targetGroupIds', to_jsonb(s.target_group_ids),
    'enabled', s.enabled,
    'lastRunOn', s.last_run_on,
    'createdAt', s.created_at,
    'updatedAt', s.updated_at
  );
$$;

-- Danh sách tất cả lịch (sắp theo giờ).
CREATE OR REPLACE FUNCTION notification_schedule_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(notification_schedule_to_json(s) ORDER BY s.time_hhmm, s.id), '[]'::jsonb)
  FROM notification_schedules s;
$$;

-- Tạo. p_input: {type,timeHHMM,days[],targetGroupIds[],enabled}. Trả {id}.
CREATE OR REPLACE FUNCTION notification_schedule_create(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_id text;
BEGIN
  INSERT INTO notification_schedules (type, time_hhmm, days, target_group_ids, enabled)
  VALUES (
    COALESCE(NULLIF(p_input->>'type',''), 'daily_summary'),
    COALESCE(NULLIF(p_input->>'timeHHMM',''), '20:00'),
    COALESCE((SELECT array_agg(value::int) FROM jsonb_array_elements_text(COALESCE(p_input->'days','[]'::jsonb)) AS value), '{}'),
    COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(COALESCE(p_input->'targetGroupIds','[]'::jsonb)) AS value), '{}'),
    COALESCE((p_input->>'enabled')::boolean, true)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- Cập nhật (chỉ field có trong payload). Trả {id}.
CREATE OR REPLACE FUNCTION notification_schedule_update(p_id text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE notification_schedules SET
    type = CASE WHEN p_input ? 'type' THEN COALESCE(NULLIF(p_input->>'type',''), type) ELSE type END,
    time_hhmm = CASE WHEN p_input ? 'timeHHMM' THEN COALESCE(NULLIF(p_input->>'timeHHMM',''), time_hhmm) ELSE time_hhmm END,
    days = CASE WHEN p_input ? 'days'
      THEN COALESCE((SELECT array_agg(value::int) FROM jsonb_array_elements_text(COALESCE(p_input->'days','[]'::jsonb)) AS value), '{}')
      ELSE days END,
    target_group_ids = CASE WHEN p_input ? 'targetGroupIds'
      THEN COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(COALESCE(p_input->'targetGroupIds','[]'::jsonb)) AS value), '{}')
      ELSE target_group_ids END,
    enabled = CASE WHEN p_input ? 'enabled' THEN COALESCE((p_input->>'enabled')::boolean, enabled) ELSE enabled END,
    updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END;
$$;

CREATE OR REPLACE FUNCTION notification_schedule_delete(p_id text)
RETURNS jsonb LANGUAGE sql AS $$
  DELETE FROM notification_schedules WHERE id = p_id RETURNING jsonb_build_object('id', id);
$$;

-- Các lịch đến hạn ngay bây giờ (giờ VN). Trả array {id,type,targetGroupIds,today}.
CREATE OR REPLACE FUNCTION notification_schedule_due()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH nowvn AS (
    SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AS t
  ), meta AS (
    SELECT to_char(t,'HH24:MI') AS hhmm, extract(dow FROM t)::int AS dow, to_char(t,'YYYY-MM-DD') AS today
    FROM nowvn
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'type', s.type, 'targetGroupIds', to_jsonb(s.target_group_ids), 'today', m.today
  )), '[]'::jsonb)
  FROM notification_schedules s, meta m
  WHERE s.enabled
    AND s.time_hhmm = m.hhmm
    AND (array_length(s.days,1) IS NULL OR m.dow = ANY(s.days))
    AND (s.last_run_on IS DISTINCT FROM m.today);
$$;

CREATE OR REPLACE FUNCTION notification_schedule_mark_run(p_id text, p_day text)
RETURNS void LANGUAGE sql AS $$
  UPDATE notification_schedules SET last_run_on = p_day, updated_at = now() WHERE id = p_id;
$$;

-- ─────────── Soạn nội dung (khớp format FE) ───────────

-- Nhãn thứ tiếng Việt ngắn (CN/T2..T7) cho 1 date.
CREATE OR REPLACE FUNCTION vn_weekday_short(d date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE extract(dow FROM d)::int
    WHEN 0 THEN 'CN' WHEN 1 THEN 'T2' WHEN 2 THEN 'T3' WHEN 3 THEN 'T4'
    WHEN 4 THEN 'T5' WHEN 5 THEN 'T6' WHEN 6 THEN 'T7' END;
$$;

-- Cần giao ngày p_date — format TƯỜNG MINH: mỗi đơn 1 khối đánh số,
-- dòng vị (🍰) + dòng ghi chú (📝) thụt lề riêng. Breakdown vị = đếm số lần
-- mỗi vị trong order_items.flavors (rỗng thì bỏ). Note = order.note.
CREATE OR REPLACE FUNCTION notification_compose_production(p_date text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_d date := to_date(p_date, 'YYYY-MM-DD');
  v_disp text := to_char(v_d, 'DD/MM/YYYY') || ' (' || vn_weekday_short(v_d) || ')';
  v_orders int;
  v_items numeric;
  v_body text;
BEGIN
  SELECT count(DISTINCT o.id), COALESCE(sum(oi.quantity), 0)
  INTO v_orders, v_items
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.delivery_date = p_date AND COALESCE(o.is_test, false) = false;

  IF COALESCE(v_orders, 0) = 0 THEN
    RETURN '✅ Ngày ' || v_disp || ' chưa có đơn nào cần giao.';
  END IF;

  SELECT string_agg(
           t.rn || '. ' || t.customer_name || ' — ' || t.qty::int || ' gói'
             || COALESCE(E'\n   🍰 ' || t.flavors, '')
             || COALESCE(E'\n   📝 ' || t.note, ''),
           E'\n' ORDER BY t.rn)
  INTO v_body
  FROM (
    SELECT o.id,
      COALESCE(NULLIF(o.customer_name, ''), '(?)') AS customer_name,
      sum(oi.quantity) AS qty,
      (SELECT string_agg(fb.cnt::int || ' ' || fb.fl, ', ' ORDER BY fb.cnt DESC, fb.fl)
       FROM (SELECT f AS fl, count(*) AS cnt
             FROM order_items x, unnest(x.flavors) f
             WHERE x.order_id = o.id AND NULLIF(f, '') IS NOT NULL
             GROUP BY f) fb) AS flavors,
      NULLIF(trim(o.note), '') AS note,
      row_number() OVER (ORDER BY COALESCE(NULLIF(o.customer_name, ''), '(?)')) AS rn
    FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.delivery_date = p_date AND COALESCE(o.is_test, false) = false
    GROUP BY o.id, o.customer_name, o.note
  ) t;

  RETURN '🚚 ĐƠN CẦN GIAO · ' || v_disp || E'\n' ||
         '━━━━━━━━━━━━━━━━' || E'\n' ||
         '📊 ' || v_orders || ' đơn · ' || v_items::int || ' gói' || E'\n\n' ||
         v_body;
END;
$$;

-- Đơn CẦN GIAO gom theo NGÀY, cho p_days ngày kể từ p_from (mặc định 3).
-- Chỉ đơn còn phải giao (loại DELIVERED/CANCELLED/RETURNED + đơn test). Bỏ qua ngày trống.
CREATE OR REPLACE FUNCTION notification_compose_delivery_by_day(p_from text, p_days int DEFAULT 3)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_from date := to_date(p_from, 'YYYY-MM-DD');
  v_days int := GREATEST(1, LEAST(COALESCE(p_days, 3), 14));
  v_body text;
BEGIN
  SELECT string_agg(blk.day_block, E'\n\n' ORDER BY blk.d)
  INTO v_body
  FROM (
    SELECT x.d,
      '▸ ' ||
        CASE (x.d - v_from) WHEN 0 THEN 'HÔM NAY' WHEN 1 THEN 'MAI' WHEN 2 THEN 'NGÀY KIA'
             ELSE vn_weekday_short(x.d) END
        || ' · ' || to_char(x.d, 'DD/MM') || ' (' || vn_weekday_short(x.d) || ') — '
        || x.o_cnt || ' đơn · ' || x.i_cnt::int || ' gói' || E'\n' || x.lines AS day_block
    FROM (
      SELECT gs::date AS d,
        (SELECT count(DISTINCT o.id) FROM orders o
           WHERE o.delivery_date = to_char(gs::date, 'YYYY-MM-DD')
             AND COALESCE(o.is_test, false) = false
             AND COALESCE(o.status, '') NOT IN ('DELIVERED', 'CANCELLED', 'RETURNED')) AS o_cnt,
        (SELECT COALESCE(sum(oi.quantity), 0)
           FROM orders o JOIN order_items oi ON oi.order_id = o.id
           WHERE o.delivery_date = to_char(gs::date, 'YYYY-MM-DD')
             AND COALESCE(o.is_test, false) = false
             AND COALESCE(o.status, '') NOT IN ('DELIVERED', 'CANCELLED', 'RETURNED')) AS i_cnt,
        (SELECT string_agg(
            '   ' || t.rn || '. ' || t.customer_name || ' — ' || t.qty::int || ' gói'
              || COALESCE(E'\n      🍰 ' || t.flavors, '')
              || COALESCE(E'\n      📝 ' || t.note, ''),
            E'\n' ORDER BY t.rn)
         FROM (
           SELECT o.id, COALESCE(NULLIF(o.customer_name, ''), '(?)') AS customer_name,
             sum(oi.quantity) AS qty,
             (SELECT string_agg(fb.cnt::int || ' ' || fb.fl, ', ' ORDER BY fb.cnt DESC, fb.fl)
              FROM (SELECT f AS fl, count(*) AS cnt FROM order_items z, unnest(z.flavors) f
                    WHERE z.order_id = o.id AND NULLIF(f, '') IS NOT NULL GROUP BY f) fb) AS flavors,
             NULLIF(trim(o.note), '') AS note,
             row_number() OVER (ORDER BY COALESCE(NULLIF(o.customer_name, ''), '(?)')) AS rn
           FROM orders o JOIN order_items oi ON oi.order_id = o.id
           WHERE o.delivery_date = to_char(gs::date, 'YYYY-MM-DD')
             AND COALESCE(o.is_test, false) = false
             AND COALESCE(o.status, '') NOT IN ('DELIVERED', 'CANCELLED', 'RETURNED')
           GROUP BY o.id, o.customer_name, o.note
         ) t) AS lines
      FROM generate_series(v_from, v_from + (v_days - 1), interval '1 day') AS gs
    ) x
    WHERE x.o_cnt > 0
  ) blk;

  IF v_body IS NULL THEN
    RETURN '✅ Không có đơn cần giao trong ' || v_days || ' ngày tới (từ ' || to_char(v_from, 'DD/MM') || ').';
  END IF;

  RETURN '📅 LỊCH GIAO SẮP TỚI · ' || v_days || ' ngày' || E'\n' ||
         '━━━━━━━━━━━━━━━━' || E'\n\n' || v_body;
END;
$$;

-- Tổng kết hôm nay: đơn tạo trong ngày VN p_date.
CREATE OR REPLACE FUNCTION notification_compose_daily_summary(p_date text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_disp text := to_char(to_date(p_date, 'YYYY-MM-DD'), 'DD/MM/YYYY');
  v_orders int; v_revenue numeric; v_paid_amt numeric; v_unpaid_amt numeric; v_top text;
BEGIN
  -- Doanh thu ghi nhận theo NGÀY GIAO (delivery_date) — hàng thực giao hôm nay.
  -- Loại đơn huỷ/hoàn (CANCELLED/RETURNED) + đơn test. Tách TIỀN đã thu / còn nợ theo payment_status.
  SELECT count(*),
         COALESCE(sum(total), 0),
         COALESCE(sum(total) FILTER (WHERE payment_status = 'PAID'), 0),
         COALESCE(sum(total) FILTER (WHERE payment_status IS DISTINCT FROM 'PAID'), 0)
  INTO v_orders, v_revenue, v_paid_amt, v_unpaid_amt
  FROM orders
  WHERE delivery_date = p_date
    AND COALESCE(is_test, false) = false
    AND status IS DISTINCT FROM 'CANCELLED'
    AND status IS DISTINCT FROM 'RETURNED';

  SELECT string_agg('   ' || rn || '. ' || name || ' × ' || qty, E'\n' ORDER BY rn)
  INTO v_top
  FROM (
    SELECT COALESCE(NULLIF(oi.product_name,''), '(?)') AS name, sum(oi.quantity) AS qty,
           row_number() OVER (ORDER BY sum(oi.quantity) DESC) AS rn
    FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.delivery_date = p_date
      AND COALESCE(o.is_test, false) = false
      AND o.status IS DISTINCT FROM 'CANCELLED'
      AND o.status IS DISTINCT FROM 'RETURNED'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 5
  ) t;

  RETURN '📊 TỔNG KẾT HÔM NAY · ' || v_disp || E'\n' ||
         '─────────────────────────' || E'\n' ||
         '📦 Đơn giao: ' || COALESCE(v_orders,0) || E'\n' ||
         '💵 Doanh thu (giao): ' || translate(to_char(COALESCE(v_revenue,0), 'FM999,999,999'), ',', '.') || ' ₫' || E'\n' ||
         '💳 Đã thu: ' || translate(to_char(COALESCE(v_paid_amt,0), 'FM999,999,999'), ',', '.') || ' ₫ · Còn nợ: ' || translate(to_char(COALESCE(v_unpaid_amt,0), 'FM999,999,999'), ',', '.') || ' ₫' ||
         CASE WHEN v_top IS NOT NULL THEN E'\n\n🏆 Top sản phẩm:\n' || v_top ELSE '' END;
END;
$$;
