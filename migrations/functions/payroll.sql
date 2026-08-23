-- ============================================================
-- Domain: payroll — tổng hợp CÔNG + GIỜ + LƯƠNG theo kỳ (tháng) cho từng NV.
-- Lương = Σ(giờ hợp lệ) × mức lương giờ ĐANG áp dụng của vị trí NV ở ngày đó
--   (wage_rate_effective). Giờ hợp lệ lấy từ attendance_day_compute (chấm thực tế
--   cắt trong khung ca vừa-đăng-ký-vừa-đi-làm) + giờ admin BỔ SUNG (attendance_adjustments).
-- Ca đi làm KHÔNG đăng ký → không tính (theo attendance_day_compute).
-- Trả jsonb camelCase. Ngày 'yyyy-mm-dd'. Múi giờ hôm nay: Asia/Ho_Chi_Minh.
-- ============================================================

-- 1 dòng bổ sung công -> jsonb (kèm tên NV).
CREATE OR REPLACE FUNCTION attendance_adjustment_to_json(a attendance_adjustments)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',           a.id,
    'employeeId',   a.employee_id,
    'employeeName', (SELECT e.name FROM employees e WHERE e.id = a.employee_id),
    'workDate',     to_char(a.work_date, 'YYYY-MM-DD'),
    'hours',        a.hours,
    'reason',       a.reason,
    'createdBy',    a.created_by,
    'createdAt',    a.created_at
  );
$$;

-- Danh sách bổ sung công. p_input: { employeeId?, from?(yyyy-mm-dd), to? }.
CREATE OR REPLACE FUNCTION attendance_adjustment_list(p_input jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(attendance_adjustment_to_json(a) ORDER BY a.work_date DESC, a.created_at DESC),
    '[]'::jsonb)
  FROM attendance_adjustments a
  WHERE (NULLIF(p_input->>'employeeId','') IS NULL OR a.employee_id = p_input->>'employeeId')
    AND (NULLIF(p_input->>'from','') IS NULL OR a.work_date >= (p_input->>'from')::date)
    AND (NULLIF(p_input->>'to','')   IS NULL OR a.work_date <= (p_input->>'to')::date);
$$;

-- Thêm 1 bổ sung công. p_input: { employeeId, workDate, hours, reason?, createdBy? }.
CREATE OR REPLACE FUNCTION attendance_adjustment_add(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id    text := 'adj_' || encode(gen_random_bytes(9), 'hex');
  v_emp   text := NULLIF(p_input->>'employeeId', '');
  v_date  date := NULLIF(p_input->>'workDate', '')::date;
  v_hours numeric := NULLIF(p_input->>'hours', '')::numeric;
  v_row   attendance_adjustments%ROWTYPE;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Thiếu nhân viên'; END IF;
  IF v_date IS NULL THEN RAISE EXCEPTION 'Thiếu ngày bổ sung'; END IF;
  IF v_hours IS NULL OR v_hours = 0 THEN RAISE EXCEPTION 'Số giờ bổ sung phải khác 0'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id = v_emp) THEN
    RAISE EXCEPTION 'Không tìm thấy nhân viên %', v_emp;
  END IF;
  INSERT INTO attendance_adjustments (id, employee_id, work_date, hours, reason, created_by)
  VALUES (
    v_id, v_emp, v_date, v_hours,
    NULLIF(trim(COALESCE(p_input->>'reason','')), ''),
    NULLIF(p_input->>'createdBy','')
  )
  RETURNING * INTO v_row;
  RETURN attendance_adjustment_to_json(v_row);
END;
$$;

-- Xoá 1 bổ sung công.
CREATE OR REPLACE FUNCTION attendance_adjustment_remove(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM attendance_adjustments WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

-- ─────────────── Tổng hợp CÔNG + GIỜ + LƯƠNG theo kỳ ───────────────
-- p_input: { from?(yyyy-mm-dd), to?(yyyy-mm-dd), employeeId? }.
--   Mặc định: tháng hiện tại (giờ VN). Bao gồm MỌI NV active (kể cả chưa có công → 0).
-- Trả: { from, to, totalSalary, totalHours, employees:[ {..., days:[...]} ] }.
CREATE OR REPLACE FUNCTION payroll_compute(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_from  date := COALESCE(NULLIF(p_input->>'from','')::date, date_trunc('month', v_today)::date);
  v_to    date := COALESCE(NULLIF(p_input->>'to','')::date,
                           (date_trunc('month', v_today) + interval '1 month - 1 day')::date);
  v_emp   text := NULLIF(p_input->>'employeeId', '');
  v_result jsonb;
BEGIN
  IF v_to < v_from THEN v_to := v_from; END IF;

  WITH days AS (
    SELECT generate_series(v_from, v_to, interval '1 day')::date AS d
  ),
  emps AS (
    SELECT e.id, e.name, e.position
    FROM employees e
    WHERE e.status = 'active' AND (v_emp IS NULL OR e.id = v_emp)
  ),
  per_day AS (
    SELECT
      e.id, e.name, e.position, d.d,
      attendance_day_compute(jsonb_build_object('employeeId', e.id, 'date', to_char(d.d, 'YYYY-MM-DD'))) AS dc,
      COALESCE((SELECT sum(a.hours) FROM attendance_adjustments a
                WHERE a.employee_id = e.id AND a.work_date = d.d), 0) AS adj_hours,
      -- Mức lương/giờ theo TỪNG NV (deal riêng), theo ngày áp dụng — KHÔNG theo vị trí nữa.
      employee_wage_effective(e.id, d.d) AS rate
    FROM emps e CROSS JOIN days d
  ),
  per_day2 AS (
    SELECT
      pd.id, pd.name, pd.position, pd.d, pd.rate, pd.adj_hours,
      COALESCE((pd.dc->>'cong')::numeric, 0)  AS cong,
      COALESCE((pd.dc->>'hours')::numeric, 0) AS work_hours,
      pd.dc->'in'  AS in_at,          -- giờ vào (chấm) — null nếu không chấm
      pd.dc->'out' AS out_at,         -- giờ ra
      COALESCE(pd.dc->'shifts', '[]'::jsonb) AS shifts,  -- chi tiết từng ca (đăng ký/làm/hợp lệ)
      COALESCE(sc.reg_cnt, 0)   AS reg_cnt,
      COALESCE(sc.valid_cnt, 0) AS valid_cnt
    FROM per_day pd
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE (s->>'registered')::boolean) AS reg_cnt,
             count(*) FILTER (WHERE (s->>'valid')::boolean)      AS valid_cnt
      FROM jsonb_array_elements(pd.dc->'shifts') s
    ) sc ON true
  ),
  per_day3 AS (
    SELECT p.*,
      (p.work_hours + p.adj_hours) AS day_hours,
      round((p.work_hours + p.adj_hours) * COALESCE(p.rate, 0)) AS day_pay
    FROM per_day2 p
  ),
  emp_rows AS (
    SELECT
      id, name, position,
      sum(day_hours)  AS total_hours,
      sum(work_hours) AS work_hours,
      sum(adj_hours)  AS adj_hours,
      sum(cong)       AS total_cong,
      sum(reg_cnt)    AS reg_shifts,
      sum(valid_cnt)  AS valid_shifts,
      sum(day_pay)    AS salary,
      jsonb_agg(jsonb_build_object(
        'date',       to_char(d, 'YYYY-MM-DD'),
        'cong',       cong,
        'workHours',  work_hours,
        'adjHours',   adj_hours,
        'hours',      day_hours,
        'rate',       rate,
        'pay',        day_pay,
        'registered', reg_cnt,
        'valid',      valid_cnt,
        'in',         in_at,
        'out',        out_at,
        'shifts',     shifts
      ) ORDER BY d)
        -- Chỉ giữ ngày CÓ hoạt động. Lưu ý: dc->'in' trả jsonb 'null' (không phải SQL NULL)
        -- khi không chấm công → phải lọc bằng jsonb_typeof = 'string' (có giờ chấm thật).
        FILTER (WHERE day_hours <> 0 OR adj_hours <> 0 OR reg_cnt > 0 OR jsonb_typeof(in_at) = 'string') AS days
    FROM per_day3
    GROUP BY id, name, position
  )
  SELECT jsonb_build_object(
    'from',        to_char(v_from, 'YYYY-MM-DD'),
    'to',          to_char(v_to, 'YYYY-MM-DD'),
    'totalSalary', COALESCE(sum(salary), 0),
    'totalHours',  COALESCE(sum(total_hours), 0),
    'employees', COALESCE(jsonb_agg(jsonb_build_object(
      'employeeId',       id,
      'name',             name,
      'position',         position,
      'totalHours',       total_hours,
      'workHours',        work_hours,
      'adjHours',         adj_hours,
      'totalCong',        total_cong,
      'registeredShifts', reg_shifts,
      'validShifts',      valid_shifts,
      'salary',           salary,
      'days',             COALESCE(days, '[]'::jsonb)
    ) ORDER BY lower(name)), '[]'::jsonb)
  )
  INTO v_result
  FROM emp_rows;

  RETURN v_result;
END;
$$;
