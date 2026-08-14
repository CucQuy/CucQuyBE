-- ============================================================
-- Domain: calendar — màn Lịch gộp nhiều nguồn event.
-- Nguồn: (1) đơn theo ngày giao, (2) ca từ setting tuần (work_shifts.weekdays),
--        (3) sự kiện tự thêm (calendar_events), (4) chấm công (attendance_records).
-- Trả jsonb array event chuẩn hoá cho FE. Ngày 'yyyy-mm-dd'.
-- ============================================================

-- 1 sự kiện tự thêm -> jsonb.
CREATE OR REPLACE FUNCTION calendar_event_to_json(c calendar_events)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',        c.id,
    'title',     c.title,
    'eventDate', to_char(c.event_date, 'YYYY-MM-DD'),
    'startTime', to_char(c.start_time, 'HH24:MI'),
    'endTime',   to_char(c.end_time,   'HH24:MI'),
    'color',     c.color,
    'note',      c.note
  );
$$;

-- Tạo/sửa sự kiện tự thêm (upsert theo id; thiếu id -> tạo mới).
-- p_input: { id?, title, eventDate:'yyyy-mm-dd', startTime?, endTime?, color?, note? }
CREATE OR REPLACE FUNCTION calendar_event_save(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id    text := NULLIF(p_input->>'id', '');
  v_title text := NULLIF(trim(p_input->>'title'), '');
  v_row   calendar_events%ROWTYPE;
BEGIN
  IF v_title IS NULL THEN RAISE EXCEPTION 'Tiêu đề là bắt buộc'; END IF;
  IF NULLIF(p_input->>'eventDate','') IS NULL THEN RAISE EXCEPTION 'Ngày là bắt buộc'; END IF;

  IF v_id IS NULL THEN
    v_id := 'ce_' || encode(gen_random_bytes(9), 'hex');
    INSERT INTO calendar_events (id, title, event_date, start_time, end_time, color, note)
    VALUES (v_id, v_title, (p_input->>'eventDate')::date,
            NULLIF(p_input->>'startTime','')::time, NULLIF(p_input->>'endTime','')::time,
            NULLIF(trim(COALESCE(p_input->>'color','')),''), NULLIF(trim(COALESCE(p_input->>'note','')),''))
    RETURNING * INTO v_row;
  ELSE
    UPDATE calendar_events SET
      title      = v_title,
      event_date = (p_input->>'eventDate')::date,
      start_time = NULLIF(p_input->>'startTime','')::time,
      end_time   = NULLIF(p_input->>'endTime','')::time,
      color      = NULLIF(trim(COALESCE(p_input->>'color','')),''),
      note       = NULLIF(trim(COALESCE(p_input->>'note','')),''),
      updated_at = now()
    WHERE id = v_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy sự kiện %', v_id; END IF;
  END IF;
  RETURN calendar_event_to_json(v_row);
END;
$$;

-- Xoá sự kiện tự thêm.
CREATE OR REPLACE FUNCTION calendar_event_remove(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM calendar_events WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

-- Gộp MỌI event trong khoảng ngày. p_input: { from:'yyyy-mm-dd', to:'yyyy-mm-dd' }.
-- Mỗi event: { id, type:'order'|'shift'|'custom'|'attendance', date, title, subtitle, time, refId, meta }.
CREATE OR REPLACE FUNCTION calendar_events_all(p_input jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH params AS (
  SELECT (p_input->>'from')::date AS d_from, (p_input->>'to')::date AS d_to
),
ev AS (
  -- 1) Đơn hàng theo ngày giao (delivery_date text ISO)
  SELECT o.delivery_date AS date_str, 'order' AS type, o.delivery_time AS time_str,
    jsonb_build_object(
      'id', 'ord_' || o.order_number, 'type', 'order', 'date', o.delivery_date,
      'title', o.order_number,
      'subtitle', COALESCE(NULLIF(o.customer_name, ''), 'Khách lẻ'),
      'time', NULLIF(o.delivery_time, ''), 'refId', o.order_number,
      'meta', jsonb_build_object('status', o.status, 'paymentStatus', o.payment_status,
                                 'deliveryType', o.delivery_type)
    ) AS e
  FROM orders o, params p
  WHERE o.delivery_date ~ '^\d{4}-\d{2}-\d{2}$'
    AND o.delivery_date >= to_char(p.d_from, 'YYYY-MM-DD')
    AND o.delivery_date <= to_char(p.d_to,   'YYYY-MM-DD')

  UNION ALL
  -- 2) Ca làm suy ra từ setting tuần (work_shifts.weekdays)
  SELECT to_char(d.day, 'YYYY-MM-DD'), 'shift', to_char(s.start_time, 'HH24:MI'),
    jsonb_build_object(
      'id', 'shift_' || to_char(d.day, 'YYYYMMDD') || '_' || s.code, 'type', 'shift',
      'date', to_char(d.day, 'YYYY-MM-DD'), 'title', s.name,
      'subtitle', to_char(s.start_time, 'HH24:MI') || '–' || to_char(s.end_time, 'HH24:MI'),
      'time', to_char(s.start_time, 'HH24:MI'), 'refId', s.code,
      'meta', jsonb_build_object('sortOrder', s.sort_order)
    )
  FROM params p
  CROSS JOIN generate_series(p.d_from, p.d_to, interval '1 day') AS d(day)
  JOIN work_shifts s ON s.active AND EXTRACT(ISODOW FROM d.day)::int = ANY (s.weekdays)

  UNION ALL
  -- 3) Sự kiện tự thêm
  SELECT to_char(c.event_date, 'YYYY-MM-DD'), 'custom', to_char(c.start_time, 'HH24:MI'),
    jsonb_build_object(
      'id', c.id, 'type', 'custom', 'date', to_char(c.event_date, 'YYYY-MM-DD'),
      'title', c.title, 'subtitle', NULLIF(c.note, ''),
      'time', to_char(c.start_time, 'HH24:MI'), 'refId', c.id,
      'meta', jsonb_build_object('color', c.color)
    )
  FROM calendar_events c, params p
  WHERE c.event_date >= p.d_from AND c.event_date <= p.d_to

  UNION ALL
  -- 4) Chấm công (gộp theo NV + ngày: giờ vào sớm nhất / ra muộn nhất)
  SELECT to_char(a.d, 'YYYY-MM-DD'), 'attendance', to_char(a.first_in, 'HH24:MI'),
    jsonb_build_object(
      'id', 'att_' || to_char(a.d, 'YYYYMMDD') || '_' || a.employee_id, 'type', 'attendance',
      'date', to_char(a.d, 'YYYY-MM-DD'),
      'title', COALESCE((SELECT e.name FROM employees e WHERE e.id = a.employee_id), 'NV'),
      'subtitle',
        NULLIF(
          trim(both ' ·' FROM
            COALESCE('Vào ' || to_char(a.first_in, 'HH24:MI'), '')
            || CASE WHEN a.last_out IS NOT NULL THEN ' · Ra ' || to_char(a.last_out, 'HH24:MI') ELSE '' END
          ), ''),
      'time', to_char(a.first_in, 'HH24:MI'), 'refId', a.employee_id,
      'meta', '{}'::jsonb
    )
  FROM (
    SELECT (r.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d, r.employee_id,
      (min(r.checked_at) FILTER (WHERE r.kind = 'in'))  AT TIME ZONE 'Asia/Ho_Chi_Minh' AS first_in,
      (max(r.checked_at) FILTER (WHERE r.kind = 'out')) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS last_out
    FROM attendance_records r, params p
    WHERE (r.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= p.d_from
      AND (r.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= p.d_to
    GROUP BY 1, 2
  ) a
)
SELECT COALESCE(
  jsonb_agg(e ORDER BY (e->>'date'), (e->>'type'), (e->>'time') NULLS FIRST),
  '[]'::jsonb)
FROM ev;
$$;
