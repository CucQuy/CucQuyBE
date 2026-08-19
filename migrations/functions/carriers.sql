-- ============================================================
-- Domain: carriers — đơn vị vận chuyển (danh bạ) 2 dạng:
--   type='express' (truyền thống) | 'coach' (xe khách: có tuyến + bến đỗ).
-- Trả jsonb camelCase.
-- ============================================================

-- orderCount = số đơn (chưa huỷ) đã gắn hãng này → thống kê "đã gửi cho ĐVVC nào".
CREATE OR REPLACE FUNCTION carrier_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'note', c.note,
      'type', COALESCE(c.type, 'express'), 'route', c.route, 'station', c.station,
      'offices', COALESCE(c.offices, '[]'::jsonb), 'routes', COALESCE(c.routes, '[]'::jsonb),
      'active', c.active, 'sortOrder', c.sort_order,
      'orderCount', COALESCE(oc.cnt, 0)
    ) ORDER BY c.sort_order, lower(c.name)),
    '[]'::jsonb)
  FROM carriers c
  LEFT JOIN (
    SELECT carrier_id, count(*) AS cnt
    FROM orders
    WHERE carrier_id IS NOT NULL AND status <> 'CANCELLED'
    GROUP BY carrier_id
  ) oc ON oc.carrier_id = c.id;
$$;

-- Thêm/sửa 1 ĐVVC. id rỗng → tạo mới; có id → cập nhật.
-- p: { id?, name, phone?, note?, type?('express'|'coach'), route?, station?, active?, sortOrder? }.
CREATE OR REPLACE FUNCTION carrier_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id   text := NULLIF(p->>'id', '');
  v_name text := trim(COALESCE(p->>'name', ''));
  v_type text := CASE WHEN p->>'type' = 'coach' THEN 'coach' ELSE 'express' END;
BEGIN
  IF v_name = '' THEN RAISE EXCEPTION 'Thiếu tên đơn vị vận chuyển'; END IF;
  IF v_id IS NULL THEN
    v_id := 'car_' || encode(gen_random_bytes(9), 'hex');
    INSERT INTO carriers (id, name, phone, note, type, route, station, offices, routes, active, sort_order)
    VALUES (v_id, v_name, NULLIF(p->>'phone',''), NULLIF(p->>'note',''),
            v_type, NULLIF(p->>'route',''), NULLIF(p->>'station',''),
            COALESCE(p->'offices', '[]'::jsonb), COALESCE(p->'routes', '[]'::jsonb),
            COALESCE((p->>'active')::boolean, true),
            COALESCE(NULLIF(p->>'sortOrder','')::int, 100));
  ELSE
    UPDATE carriers SET
      name = v_name,
      phone = NULLIF(p->>'phone',''),
      note = NULLIF(p->>'note',''),
      type = v_type,
      route = NULLIF(p->>'route',''),
      station = NULLIF(p->>'station',''),
      -- offices/routes: chỉ đụng khi payload gửi (giữ nguyên khi vắng).
      offices = CASE WHEN p ? 'offices' THEN COALESCE(p->'offices', '[]'::jsonb) ELSE offices END,
      routes  = CASE WHEN p ? 'routes'  THEN COALESCE(p->'routes',  '[]'::jsonb) ELSE routes END,
      active = COALESCE((p->>'active')::boolean, active),
      sort_order = COALESCE(NULLIF(p->>'sortOrder','')::int, sort_order)
    WHERE id = v_id;
  END IF;
  RETURN carrier_list();
END;
$$;

CREATE OR REPLACE FUNCTION carrier_delete(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM carriers WHERE id = p_id;
  RETURN carrier_list();
END;
$$;
