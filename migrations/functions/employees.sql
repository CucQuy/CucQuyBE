-- ============================================================
-- Domain: employees — hồ sơ nhân sự (CRUD cơ bản). Raw SQL, logic ở stored function.
-- Trả jsonb camelCase cho FE. Ngày lưu dạng date; serialize thành 'yyyy-mm-dd'.
-- ============================================================

-- 1 nhân viên -> jsonb (camelCase).
CREATE OR REPLACE FUNCTION employee_to_json(e employees)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',         e.id,
    'name',       e.name,
    'position',   e.position,
    'phone',      e.phone,
    'startDate',  to_char(e.start_date, 'YYYY-MM-DD'),
    'baseSalary', e.base_salary,
    'status',     e.status,
    'note',       e.note,
    'createdAt',  e.created_at,
    'updatedAt',  e.updated_at
  );
$$;

-- Danh sách nhân viên (đang làm trước, rồi theo tên).
CREATE OR REPLACE FUNCTION employee_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(employee_to_json(e)
      ORDER BY (e.status <> 'active'), lower(e.name) ASC),
    '[]'::jsonb)
  FROM employees e;
$$;

-- Tạo nhân viên. p_input jsonb camelCase: name (bắt buộc), position, phone,
-- startDate (yyyy-mm-dd), baseSalary, status, note.
CREATE OR REPLACE FUNCTION employee_create(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'emp_' || encode(gen_random_bytes(9), 'hex');
  v_name text := NULLIF(trim(p_input->>'name'), '');
  v_row employees%ROWTYPE;
BEGIN
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Tên nhân viên là bắt buộc';
  END IF;
  INSERT INTO employees (id, name, position, phone, start_date, base_salary, status, note)
  VALUES (
    v_id,
    v_name,
    NULLIF(trim(COALESCE(p_input->>'position','')), ''),
    NULLIF(trim(COALESCE(p_input->>'phone','')), ''),
    NULLIF(p_input->>'startDate','')::date,
    NULLIF(p_input->>'baseSalary','')::numeric,
    COALESCE(NULLIF(p_input->>'status',''), 'active'),
    NULLIF(trim(COALESCE(p_input->>'note','')), '')
  )
  RETURNING * INTO v_row;
  RETURN employee_to_json(v_row);
END;
$$;

-- Cập nhật nhân viên (partial: chỉ field CÓ trong p_input mới đổi). name rỗng -> bỏ qua.
CREATE OR REPLACE FUNCTION employee_update(p_id text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_row employees%ROWTYPE;
BEGIN
  UPDATE employees SET
    name        = CASE WHEN p_input ? 'name' AND NULLIF(trim(p_input->>'name'),'') IS NOT NULL
                       THEN trim(p_input->>'name') ELSE name END,
    position    = CASE WHEN p_input ? 'position'   THEN NULLIF(trim(COALESCE(p_input->>'position','')),'') ELSE position END,
    phone       = CASE WHEN p_input ? 'phone'      THEN NULLIF(trim(COALESCE(p_input->>'phone','')),'') ELSE phone END,
    start_date  = CASE WHEN p_input ? 'startDate'  THEN NULLIF(p_input->>'startDate','')::date ELSE start_date END,
    base_salary = CASE WHEN p_input ? 'baseSalary' THEN NULLIF(p_input->>'baseSalary','')::numeric ELSE base_salary END,
    status      = CASE WHEN p_input ? 'status' AND NULLIF(p_input->>'status','') IS NOT NULL
                       THEN p_input->>'status' ELSE status END,
    note        = CASE WHEN p_input ? 'note'       THEN NULLIF(trim(COALESCE(p_input->>'note','')),'') ELSE note END,
    updated_at  = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN employee_to_json(v_row);
END;
$$;

-- Xoá nhân viên.
CREATE OR REPLACE FUNCTION employee_delete(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM employees WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;
