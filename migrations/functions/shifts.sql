-- ============================================================
-- Domain: shifts — ca làm + phân ca theo ngày (lịch). Raw SQL, logic ở stored function.
-- Trả jsonb camelCase cho FE. Ngày 'yyyy-mm-dd', giờ 'HH24:MI'.
-- ============================================================

-- Danh sách ca định nghĩa (kèm thứ trong tuần áp dụng). Lấy CẢ ca tắt để trang cài đặt sửa lại.
CREATE OR REPLACE FUNCTION work_shift_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'code',       s.code,
      'name',       s.name,
      'startTime',  to_char(s.start_time, 'HH24:MI'),
      'endTime',    to_char(s.end_time,   'HH24:MI'),
      'congFactor', s.cong_factor,
      'sortOrder',  s.sort_order,
      'weekdays',   to_jsonb(s.weekdays),
      'active',     s.active
    ) ORDER BY s.sort_order),
    '[]'::jsonb)
  FROM work_shifts s;
$$;

-- Lưu cài đặt ca (upsert theo code): giờ + thứ trong tuần + bật/tắt. KHÔNG xoá ca.
-- p_items: [{ code, name?, startTime:'HH:MM', endTime:'HH:MM', weekdays:[1..7], sortOrder?, congFactor?, active? }]
CREATE OR REPLACE FUNCTION work_shift_save_all(p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE it jsonb;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    IF NULLIF(it->>'code', '') IS NULL THEN CONTINUE; END IF;
    INSERT INTO work_shifts (code, name, start_time, end_time, cong_factor, sort_order, weekdays, active)
    VALUES (
      it->>'code',
      COALESCE(NULLIF(trim(it->>'name'), ''), it->>'code'),
      (it->>'startTime')::time,
      (it->>'endTime')::time,
      COALESCE(NULLIF(it->>'congFactor', '')::numeric, 0.5),
      COALESCE(NULLIF(it->>'sortOrder', '')::int, 0),
      CASE WHEN it ? 'weekdays'
           THEN ARRAY(SELECT jsonb_array_elements_text(it->'weekdays')::int)
           ELSE ARRAY[1,2,3,4,5,6,7] END,
      COALESCE((it->>'active')::boolean, true)
    )
    ON CONFLICT (code) DO UPDATE SET
      name        = EXCLUDED.name,
      start_time  = EXCLUDED.start_time,
      end_time    = EXCLUDED.end_time,
      cong_factor = EXCLUDED.cong_factor,
      sort_order  = EXCLUDED.sort_order,
      weekdays    = EXCLUDED.weekdays,
      active      = EXCLUDED.active;
  END LOOP;
  RETURN work_shift_list();
END;
$$;

-- 1 phân ca -> jsonb (kèm tên NV).
CREATE OR REPLACE FUNCTION shift_assignment_to_json(a shift_assignments)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',           a.id,
    'employeeId',   a.employee_id,
    'employeeName', (SELECT e.name FROM employees e WHERE e.id = a.employee_id),
    'workDate',     to_char(a.work_date, 'YYYY-MM-DD'),
    'shiftCode',    a.shift_code,
    'note',         a.note
  );
$$;

-- Phân ca trong khoảng ngày (cho calendar). p_input: { from:'yyyy-mm-dd', to:'yyyy-mm-dd' }.
CREATE OR REPLACE FUNCTION shift_assignment_range(p_input jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(shift_assignment_to_json(a)
      ORDER BY a.work_date, a.shift_code,
               (SELECT lower(e.name) FROM employees e WHERE e.id = a.employee_id)),
    '[]'::jsonb)
  FROM shift_assignments a
  WHERE a.work_date >= (p_input->>'from')::date
    AND a.work_date <= (p_input->>'to')::date;
$$;

-- Đặt TRỌN danh sách NV cho 1 (ngày, ca): thêm NV mới, xoá NV không còn.
-- p_input: { workDate:'yyyy-mm-dd', shiftCode:'ca1', employeeIds:['emp_..',..] }.
-- employeeIds rỗng => xoá hết NV của ca đó trong ngày. Trả về danh sách sau khi cập nhật.
CREATE OR REPLACE FUNCTION shift_assignment_set_day(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_date  date   := NULLIF(p_input->>'workDate', '')::date;
  v_shift text   := NULLIF(p_input->>'shiftCode', '');
  v_ids   text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_input->'employeeIds')), '{}');
BEGIN
  IF v_date IS NULL OR v_shift IS NULL THEN
    RAISE EXCEPTION 'workDate và shiftCode là bắt buộc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM work_shifts WHERE code = v_shift) THEN
    RAISE EXCEPTION 'Ca không hợp lệ: %', v_shift;
  END IF;

  -- Xoá NV không còn trong danh sách (v_ids rỗng => xoá tất cả của ca đó trong ngày).
  DELETE FROM shift_assignments
  WHERE work_date = v_date AND shift_code = v_shift
    AND NOT (employee_id = ANY (v_ids));

  -- Thêm NV mới (bỏ qua id không có thật; chống trùng).
  INSERT INTO shift_assignments (id, employee_id, work_date, shift_code)
  SELECT 'sa_' || encode(gen_random_bytes(9), 'hex'), eid, v_date, v_shift
  FROM unnest(v_ids) AS eid
  WHERE EXISTS (SELECT 1 FROM employees e WHERE e.id = eid)
    AND NOT EXISTS (
      SELECT 1 FROM shift_assignments x
      WHERE x.work_date = v_date AND x.shift_code = v_shift AND x.employee_id = eid
    );

  RETURN COALESCE((
    SELECT jsonb_agg(shift_assignment_to_json(a)
      ORDER BY (SELECT lower(e.name) FROM employees e WHERE e.id = a.employee_id))
    FROM shift_assignments a
    WHERE a.work_date = v_date AND a.shift_code = v_shift
  ), '[]'::jsonb);
END;
$$;

-- Xoá 1 phân ca theo id.
CREATE OR REPLACE FUNCTION shift_assignment_remove(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM shift_assignments WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;
