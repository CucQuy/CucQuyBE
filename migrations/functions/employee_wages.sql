-- ============================================================
-- Domain: employee_wages — mức lương/giờ theo TỪNG NV (deal riêng) + lịch sử.
-- Trả jsonb camelCase. Ngày 'yyyy-mm-dd'. Múi giờ hôm nay: Asia/Ho_Chi_Minh.
-- Tên file sắp xếp TRƯỚC employees.sql (dấu '_' < 's') để employee_to_json gọi được
-- employee_wage_effective lúc tạo hàm.
-- ============================================================

CREATE OR REPLACE FUNCTION employee_wage_to_json(w employee_wage_rates)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',            w.id,
    'employeeId',    w.employee_id,
    'hourlyRate',    w.hourly_rate,
    'effectiveDate', to_char(w.effective_date, 'YYYY-MM-DD'),
    'note',          w.note,
    'createdAt',     w.created_at
  );
$$;

-- Toàn bộ mức lương của 1 NV (mới áp dụng trước).
CREATE OR REPLACE FUNCTION employee_wage_list(p_employee_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(employee_wage_to_json(w) ORDER BY w.effective_date DESC, w.created_at DESC),
    '[]'::jsonb)
  FROM employee_wage_rates w
  WHERE w.employee_id = p_employee_id;
$$;

-- Mức/giờ ĐANG áp dụng cho (NV, ngày). NULL nếu chưa đặt.
CREATE OR REPLACE FUNCTION employee_wage_effective(p_employee_id text, p_date date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT w.hourly_rate
  FROM employee_wage_rates w
  WHERE w.employee_id = p_employee_id
    AND w.effective_date <= p_date
  ORDER BY w.effective_date DESC, w.created_at DESC
  LIMIT 1;
$$;

-- Thêm 1 mức lương cho NV. p_input: { employeeId, hourlyRate, effectiveDate, note? }.
CREATE OR REPLACE FUNCTION employee_wage_add(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id   text := 'ewr_' || encode(gen_random_bytes(9), 'hex');
  v_emp  text := NULLIF(p_input->>'employeeId', '');
  v_rate numeric := NULLIF(p_input->>'hourlyRate', '')::numeric;
  v_date date := NULLIF(p_input->>'effectiveDate', '')::date;
  v_row  employee_wage_rates%ROWTYPE;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Thiếu nhân viên'; END IF;
  IF v_rate IS NULL OR v_rate < 0 THEN RAISE EXCEPTION 'Mức lương/giờ không hợp lệ'; END IF;
  IF v_date IS NULL THEN RAISE EXCEPTION 'Thiếu ngày áp dụng'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id = v_emp) THEN
    RAISE EXCEPTION 'Không tìm thấy nhân viên %', v_emp;
  END IF;
  INSERT INTO employee_wage_rates (id, employee_id, hourly_rate, effective_date, note)
  VALUES (v_id, v_emp, v_rate, v_date, NULLIF(trim(COALESCE(p_input->>'note','')), ''))
  RETURNING * INTO v_row;
  RETURN employee_wage_to_json(v_row);
END;
$$;

-- Xoá 1 mức lương.
CREATE OR REPLACE FUNCTION employee_wage_remove(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM employee_wage_rates WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;
