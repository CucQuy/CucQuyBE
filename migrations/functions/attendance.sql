-- ============================================================
-- Domain: attendance — chấm công + face descriptor + whitelist IP mạng quán.
-- Raw SQL, logic ở stored function. Trả jsonb camelCase cho FE.
-- Nhận diện/so khớp khuôn mặt tính ở BE (face-api); các hàm ở đây chỉ CRUD dữ liệu.
-- Múi giờ tính "hôm nay": Asia/Ho_Chi_Minh.
-- ============================================================

-- 1 bản ghi chấm công -> jsonb (kèm tên nhân viên).
CREATE OR REPLACE FUNCTION attendance_record_to_json(r attendance_records)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',           r.id,
    'employeeId',   r.employee_id,
    'employeeName', (SELECT e.name FROM employees e WHERE e.id = r.employee_id),
    'kind',         r.kind,
    'checkedAt',    r.checked_at,
    'ip',           r.ip,
    'faceDistance', r.face_distance,
    'imageUrl',     r.image_url,
    'note',         r.note
  );
$$;

-- Trạng thái IP: đã cấu hình whitelist chưa + IP hiện tại có được phép không.
CREATE OR REPLACE FUNCTION attendance_ip_status(p_ip text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_configured boolean := EXISTS(SELECT 1 FROM attendance_allowed_networks WHERE active);
  v_allowed boolean := false;
BEGIN
  BEGIN
    v_allowed := EXISTS(
      SELECT 1 FROM attendance_allowed_networks
      WHERE active AND p_ip::inet <<= ip_cidr
    );
  EXCEPTION WHEN others THEN
    v_allowed := false; -- p_ip rỗng/không hợp lệ
  END;
  RETURN jsonb_build_object('configured', v_configured, 'allowed', v_allowed, 'ip', p_ip);
END;
$$;

-- Danh sách dải mạng cho phép.
CREATE OR REPLACE FUNCTION attendance_networks_list()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'ipCidr', host(ip_cidr) ||
        CASE WHEN masklen(ip_cidr) = 32 THEN '' ELSE '/' || masklen(ip_cidr) END,
      'active', active, 'createdAt', created_at
    ) ORDER BY created_at DESC),
    '[]'::jsonb)
  FROM attendance_allowed_networks;
$$;

-- Thêm/sửa dải mạng. p_input: {id?, label, ipCidr, active}.
CREATE OR REPLACE FUNCTION attendance_networks_upsert(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id text := NULLIF(p_input->>'id', '');
  v_cidr text := NULLIF(trim(p_input->>'ipCidr'), '');
  v_label text := NULLIF(trim(COALESCE(p_input->>'label','')), '');
  v_active boolean := COALESCE((p_input->>'active')::boolean, true);
  v_row attendance_allowed_networks%ROWTYPE;
BEGIN
  IF v_cidr IS NULL THEN
    RAISE EXCEPTION 'Thiếu IP/dải mạng (ipCidr)';
  END IF;
  IF v_id IS NULL THEN
    v_id := 'net_' || encode(gen_random_bytes(9), 'hex');
    INSERT INTO attendance_allowed_networks (id, label, ip_cidr, active)
    VALUES (v_id, v_label, v_cidr::cidr, v_active)
    RETURNING * INTO v_row;
  ELSE
    UPDATE attendance_allowed_networks
    SET label = v_label, ip_cidr = v_cidr::cidr, active = v_active
    WHERE id = v_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dải mạng %', v_id; END IF;
  END IF;
  RETURN jsonb_build_object(
    'id', v_row.id, 'label', v_row.label,
    'ipCidr', host(v_row.ip_cidr) ||
      CASE WHEN masklen(v_row.ip_cidr) = 32 THEN '' ELSE '/' || masklen(v_row.ip_cidr) END,
    'active', v_row.active, 'createdAt', v_row.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION attendance_networks_delete(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM attendance_allowed_networks WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

-- Nối tài khoản đăng nhập (email) -> hồ sơ nhân sự. Trả null nếu chưa gắn.
CREATE OR REPLACE FUNCTION employee_resolve_by_email(p_email text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'name', e.name, 'email', e.email, 'status', e.status,
    'faceCount', (SELECT count(*) FROM employee_face_descriptors f WHERE f.employee_id = e.id)
  )
  FROM employees e
  WHERE p_email IS NOT NULL AND lower(e.email) = lower(p_email)
  ORDER BY (e.status = 'active') DESC
  LIMIT 1;
$$;

-- Danh sách vector khuôn mặt của 1 NV (KÈM descriptor để BE so khớp).
CREATE OR REPLACE FUNCTION employee_face_list(p_employee_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id', id, 'descriptor', descriptor, 'imageUrl', image_url, 'createdAt', created_at
    ) ORDER BY created_at DESC),
    '[]'::jsonb)
  FROM employee_face_descriptors WHERE employee_id = p_employee_id;
$$;

-- Thêm 1 mẫu khuôn mặt. p_input: {employeeId, descriptor:[128 số], imageUrl?}.
CREATE OR REPLACE FUNCTION employee_face_add(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'face_' || encode(gen_random_bytes(9), 'hex');
  v_emp text := NULLIF(p_input->>'employeeId', '');
  v_desc jsonb := p_input->'descriptor';
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Thiếu employeeId'; END IF;
  IF v_desc IS NULL OR jsonb_typeof(v_desc) <> 'array' OR jsonb_array_length(v_desc) <> 128 THEN
    RAISE EXCEPTION 'Vector khuôn mặt không hợp lệ (cần mảng 128 số)';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id = v_emp) THEN
    RAISE EXCEPTION 'Không tìm thấy nhân viên %', v_emp;
  END IF;
  INSERT INTO employee_face_descriptors (id, employee_id, descriptor, image_url)
  VALUES (v_id, v_emp, v_desc, NULLIF(p_input->>'imageUrl',''));
  RETURN jsonb_build_object(
    'id', v_id, 'employeeId', v_emp,
    'faceCount', (SELECT count(*) FROM employee_face_descriptors WHERE employee_id = v_emp)
  );
END;
$$;

-- Xoá toàn bộ mẫu khuôn mặt của 1 NV (đăng ký lại).
CREATE OR REPLACE FUNCTION employee_face_clear(p_employee_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  DELETE FROM employee_face_descriptors WHERE employee_id = p_employee_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', v_n);
END;
$$;

-- Ghi 1 lần chấm công. p_input: {employeeId, kind, ip?, faceDistance?, imageUrl?, note?}.
-- (BE đã kiểm IP + khớp mặt TRƯỚC khi gọi hàm này.)
CREATE OR REPLACE FUNCTION attendance_add(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'att_' || encode(gen_random_bytes(9), 'hex');
  v_emp text := NULLIF(p_input->>'employeeId', '');
  v_kind text := NULLIF(p_input->>'kind', '');
  v_row attendance_records%ROWTYPE;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Thiếu employeeId'; END IF;
  IF v_kind NOT IN ('in', 'out') THEN RAISE EXCEPTION 'kind phải là in/out'; END IF;
  INSERT INTO attendance_records (id, employee_id, kind, ip, face_distance, image_url, note)
  VALUES (
    v_id, v_emp, v_kind,
    NULLIF(p_input->>'ip',''),
    NULLIF(p_input->>'faceDistance','')::numeric,
    NULLIF(p_input->>'imageUrl',''),
    NULLIF(trim(COALESCE(p_input->>'note','')), '')
  )
  RETURNING * INTO v_row;
  RETURN attendance_record_to_json(v_row);
END;
$$;

-- Trạng thái chấm công của 1 NV hôm nay (giờ VN).
CREATE OR REPLACE FUNCTION attendance_status_for(p_employee_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_last attendance_records%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  SELECT * INTO v_last FROM attendance_records
  WHERE employee_id = p_employee_id ORDER BY checked_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'employeeId', p_employee_id,
    'faceCount', (SELECT count(*) FROM employee_face_descriptors WHERE employee_id = p_employee_id),
    'lastKind', v_last.kind,
    'lastAt', v_last.checked_at,
    'todayIn', (SELECT min(checked_at) FROM attendance_records
                WHERE employee_id = p_employee_id AND kind = 'in'
                  AND (checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today),
    'todayOut', (SELECT max(checked_at) FROM attendance_records
                 WHERE employee_id = p_employee_id AND kind = 'out'
                   AND (checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today),
    'todayCount', (SELECT count(*) FROM attendance_records
                   WHERE employee_id = p_employee_id
                     AND (checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today)
  );
END;
$$;

-- Lịch sử chấm công (admin). p_input: {employeeId?, from?(yyyy-mm-dd), to?, limit?, offset?}.
CREATE OR REPLACE FUNCTION attendance_list(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_emp text := NULLIF(p_input->>'employeeId', '');
  v_from date := NULLIF(p_input->>'from','')::date;
  v_to date := NULLIF(p_input->>'to','')::date;
  v_limit int := LEAST(COALESCE(NULLIF(p_input->>'limit','')::int, 100), 500);
  v_offset int := COALESCE(NULLIF(p_input->>'offset','')::int, 0);
  v_items jsonb;
  v_total bigint;
BEGIN
  -- tổng số bản ghi khớp filter (không tính limit) — đếm riêng để không lẫn với jsonb_agg.
  SELECT count(*) INTO v_total
  FROM attendance_records r
  WHERE (v_emp IS NULL OR r.employee_id = v_emp)
    AND (v_from IS NULL OR (r.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_from)
    AND (v_to IS NULL OR (r.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= v_to);

  SELECT COALESCE(jsonb_agg(attendance_record_to_json(r) ORDER BY r.checked_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT * FROM attendance_records r
    WHERE (v_emp IS NULL OR r.employee_id = v_emp)
      AND (v_from IS NULL OR (r.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_from)
      AND (v_to IS NULL OR (r.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= v_to)
    ORDER BY r.checked_at DESC
    LIMIT v_limit OFFSET v_offset
  ) r;
  RETURN jsonb_build_object('items', v_items, 'total', COALESCE(v_total, 0), 'limit', v_limit, 'offset', v_offset);
END;
$$;

-- Tổng quan quản lý: mọi NV active kèm email, số mẫu mặt, trạng thái hôm nay.
CREATE OR REPLACE FUNCTION attendance_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'employeeId', e.id,
      'name', e.name,
      'email', e.email,
      'position', e.position,
      'status', e.status,
      'faceCount', (SELECT count(*) FROM employee_face_descriptors f WHERE f.employee_id = e.id),
      'todayIn', (SELECT min(checked_at) FROM attendance_records a
                  WHERE a.employee_id = e.id AND a.kind = 'in'
                    AND (a.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today),
      'todayOut', (SELECT max(checked_at) FROM attendance_records a
                   WHERE a.employee_id = e.id AND a.kind = 'out'
                     AND (a.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today)
    ) ORDER BY (e.status <> 'active'), lower(e.name))
    FROM employees e
  ), '[]'::jsonb);
END;
$$;
