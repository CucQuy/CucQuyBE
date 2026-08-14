-- ============================================================
-- Domain: wages — mức lương giờ theo vị trí + lịch sử thay đổi.
-- Trả jsonb camelCase. Ngày 'yyyy-mm-dd'.
-- ============================================================

CREATE OR REPLACE FUNCTION wage_rate_to_json(w wage_rates)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',            w.id,
    'position',      w.position,
    'hourlyRate',    w.hourly_rate,
    'weekdays',      to_jsonb(w.weekdays),
    'effectiveDate', to_char(w.effective_date, 'YYYY-MM-DD'),
    'note',          w.note,
    'createdAt',     w.created_at
  );
$$;

-- Toàn bộ mức lương (mọi vị trí, mọi lịch sử) — mới áp dụng trước.
CREATE OR REPLACE FUNCTION wage_rate_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(wage_rate_to_json(w)
      ORDER BY lower(w.position), w.effective_date DESC, w.created_at DESC),
    '[]'::jsonb)
  FROM wage_rates w;
$$;

-- Thêm 1 mức lương (1 bản ghi lịch sử). p_input:
--  { position, hourlyRate, weekdays:[1..7], effectiveDate:'yyyy-mm-dd', note? }
CREATE OR REPLACE FUNCTION wage_rate_add(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id       text := 'wr_' || encode(gen_random_bytes(9), 'hex');
  v_position text := NULLIF(trim(p_input->>'position'), '');
  v_rate     numeric := NULLIF(p_input->>'hourlyRate', '')::numeric;
  v_row      wage_rates%ROWTYPE;
BEGIN
  IF v_position IS NULL THEN RAISE EXCEPTION 'Vị trí là bắt buộc'; END IF;
  IF v_rate IS NULL OR v_rate < 0 THEN RAISE EXCEPTION 'Mức lương/giờ không hợp lệ'; END IF;
  IF NULLIF(p_input->>'effectiveDate','') IS NULL THEN RAISE EXCEPTION 'Ngày áp dụng là bắt buộc'; END IF;

  INSERT INTO wage_rates (id, position, hourly_rate, weekdays, effective_date, note)
  VALUES (
    v_id, v_position, v_rate,
    CASE WHEN p_input ? 'weekdays'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_input->'weekdays')::int)
         ELSE ARRAY[1,2,3,4,5,6,7] END,
    (p_input->>'effectiveDate')::date,
    NULLIF(trim(COALESCE(p_input->>'note','')), '')
  )
  RETURNING * INTO v_row;
  RETURN wage_rate_to_json(v_row);
END;
$$;

-- Xoá 1 bản ghi mức lương.
CREATE OR REPLACE FUNCTION wage_rate_remove(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM wage_rates WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

-- Mức lương/giờ ĐANG áp dụng cho (vị trí, ngày, thứ ISO). NULL nếu chưa có.
-- Dùng cho bước tính công × lương sau.
CREATE OR REPLACE FUNCTION wage_rate_effective(p_position text, p_date date, p_dow int)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT w.hourly_rate
  FROM wage_rates w
  WHERE lower(w.position) = lower(p_position)
    AND w.effective_date <= p_date
    AND p_dow = ANY (w.weekdays)
  ORDER BY w.effective_date DESC, w.created_at DESC
  LIMIT 1;
$$;
