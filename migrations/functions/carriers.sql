-- ============================================================
-- Domain: carriers — đơn vị vận chuyển (danh bạ). Trả jsonb camelCase.
-- ============================================================

CREATE OR REPLACE FUNCTION carrier_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'phone', phone, 'note', note,
      'active', active, 'sortOrder', sort_order
    ) ORDER BY sort_order, lower(name)),
    '[]'::jsonb)
  FROM carriers;
$$;

-- Thêm/sửa 1 ĐVVC. id rỗng → tạo mới; có id → cập nhật. p: { id?, name, phone?, note?, active?, sortOrder? }.
CREATE OR REPLACE FUNCTION carrier_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id   text := NULLIF(p->>'id', '');
  v_name text := trim(COALESCE(p->>'name', ''));
BEGIN
  IF v_name = '' THEN RAISE EXCEPTION 'Thiếu tên đơn vị vận chuyển'; END IF;
  IF v_id IS NULL THEN
    v_id := 'car_' || encode(gen_random_bytes(9), 'hex');
    INSERT INTO carriers (id, name, phone, note, active, sort_order)
    VALUES (v_id, v_name, NULLIF(p->>'phone',''), NULLIF(p->>'note',''),
            COALESCE((p->>'active')::boolean, true),
            COALESCE(NULLIF(p->>'sortOrder','')::int, 100));
  ELSE
    UPDATE carriers SET
      name = v_name,
      phone = NULLIF(p->>'phone',''),
      note = NULLIF(p->>'note',''),
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
