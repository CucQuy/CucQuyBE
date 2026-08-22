-- ============================================================
-- Domain: attendance — chấm công + face descriptor + whitelist IP mạng quán.
-- Raw SQL, logic ở stored function. Trả jsonb camelCase cho FE.
-- Nhận diện/so khớp khuôn mặt tính ở BE (face-api); các hàm ở đây chỉ CRUD dữ liệu.
-- Múi giờ tính "hôm nay": Asia/Ho_Chi_Minh.
-- ============================================================

-- Suy ra CA làm việc từ thời điểm chấm + loại (in/out) — giờ VN. KHÔNG lưu cột,
-- derive lúc đọc để luôn nhất quán khi đổi khung giờ ca.
--   Ca1 08:00–12:00, Ca2 13:30–17:30, Ca3 17:30–21:30.
-- Cắt tại 12:45 (giữa ca1–ca2) và 17:30 (biên ca2–ca3). Tại biên 17:30:
--   'out' → ca2 (đang KẾT THÚC), 'in' → ca3 (đang BẮT ĐẦU). 765'=12:45, 1050'=17:30.
CREATE OR REPLACE FUNCTION attendance_shift_at(p_ts timestamptz, p_kind text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE v_m int;
BEGIN
  IF p_ts IS NULL THEN RETURN NULL; END IF;
  v_m := (EXTRACT(hour   FROM (p_ts AT TIME ZONE 'Asia/Ho_Chi_Minh')) * 60
        + EXTRACT(minute FROM (p_ts AT TIME ZONE 'Asia/Ho_Chi_Minh')))::int;
  IF p_kind = 'out' THEN
    RETURN CASE WHEN v_m < 765 THEN 'ca1' WHEN v_m <= 1050 THEN 'ca2' ELSE 'ca3' END;
  ELSE
    RETURN CASE WHEN v_m < 765 THEN 'ca1' WHEN v_m <  1050 THEN 'ca2' ELSE 'ca3' END;
  END IF;
END;
$$;

-- 1 bản ghi chấm công -> jsonb (kèm tên nhân viên + ca suy ra).
CREATE OR REPLACE FUNCTION attendance_record_to_json(r attendance_records)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',           r.id,
    'employeeId',   r.employee_id,
    'employeeName', (SELECT e.name FROM employees e WHERE e.id = r.employee_id),
    'kind',         r.kind,
    'shift',        attendance_shift_at(r.checked_at, r.kind),
    'checkedAt',    r.checked_at,
    'ip',           r.ip,
    'faceDistance', r.face_distance,
    'imageUrl',     r.image_url,
    'note',         r.note
  );
$$;

-- Gợi ý DẢI (prefix) để whitelist từ 1 IP: IPv6 → /48 (khối nhà mạng cấp cho router;
-- bắt MỌI địa chỉ IPv6 quán sinh ra dù đổi /64,/56 theo máy/lần kết nối), IPv4 → /32.
-- Rỗng/không hợp lệ → ''.
CREATE OR REPLACE FUNCTION attendance_suggest_cidr(p_ip text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_msk int;
BEGIN
  IF p_ip IS NULL OR trim(p_ip) = '' THEN RETURN ''; END IF;
  v_msk := CASE WHEN family(p_ip::inet) = 6 THEN 48 ELSE 32 END;
  RETURN set_masklen(p_ip::inet, v_msk)::cidr::text;
EXCEPTION WHEN others THEN
  RETURN '';
END;
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

-- ─────────────── Tính CÔNG theo ca ĐĂNG KÝ (đăng ký công) ───────────────
-- Với 1 NV + 1 ngày: đối chiếu ca ĐÃ ĐĂNG KÝ (shift_assignments) với ca ĐÃ LÀM
-- (khoảng [check-in đầu … check-out cuối] phủ ≥ 50% thời lượng ca).
--   Ca hợp lệ (tính công) = đăng ký ∩ đã làm.
--   status: 'valid' (đăng ký + làm) | 'missed' (đăng ký, không làm) |
--           'unregistered' (làm, không đăng ký → KHÔNG tính công) | 'off' (không đăng ký, không làm).
-- Ngày = hôm nay & chưa check-out → dùng now() làm mốc ra tạm (hiện ca hợp lệ realtime).
-- p_input: { employeeId, date?('yyyy-mm-dd', mặc định hôm nay) }.
CREATE OR REPLACE FUNCTION attendance_day_compute(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_emp     text := NULLIF(p_input->>'employeeId', '');
  v_today   date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_date    date := COALESCE(NULLIF(p_input->>'date', '')::date, v_today);
  v_in      timestamptz;
  v_out     timestamptz;   -- mốc ra THỰC (trả ra ngoài)
  v_out_eff timestamptz;   -- mốc ra hiệu lực để tính (có thể = now() nếu đang trong ca hôm nay)
  v_in_min  int;
  v_out_min int;
  v_shifts  jsonb;
  v_cong    numeric := 0;
  v_hours   numeric := 0;   -- tổng GIỜ hợp lệ (thời gian chấm cắt trong khung ca hợp lệ)
BEGIN
  IF v_emp IS NULL THEN RETURN NULL; END IF;

  SELECT min(checked_at) INTO v_in FROM attendance_records
    WHERE employee_id = v_emp AND kind = 'in'
      AND (checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_date;
  SELECT max(checked_at) INTO v_out FROM attendance_records
    WHERE employee_id = v_emp AND kind = 'out'
      AND (checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_date;

  v_out_eff := v_out;
  IF v_out_eff IS NULL AND v_in IS NOT NULL AND v_date = v_today THEN
    v_out_eff := now();
  END IF;

  v_in_min  := CASE WHEN v_in IS NULL THEN NULL ELSE
    (EXTRACT(hour FROM (v_in AT TIME ZONE 'Asia/Ho_Chi_Minh'))*60
     + EXTRACT(minute FROM (v_in AT TIME ZONE 'Asia/Ho_Chi_Minh')))::int END;
  v_out_min := CASE WHEN v_out_eff IS NULL THEN NULL ELSE
    (EXTRACT(hour FROM (v_out_eff AT TIME ZONE 'Asia/Ho_Chi_Minh'))*60
     + EXTRACT(minute FROM (v_out_eff AT TIME ZONE 'Asia/Ho_Chi_Minh')))::int END;

  WITH c AS (
    SELECT ws.code, ws.name, ws.cong_factor, ws.sort_order,
           EXISTS (SELECT 1 FROM shift_assignments a
                    WHERE a.employee_id = v_emp AND a.work_date = v_date AND a.shift_code = ws.code) AS reg,
           -- Số phút thời gian chấm [in…out] phủ lên khung ca (0 nếu chưa đủ dữ liệu chấm).
           CASE WHEN v_in_min IS NULL OR v_out_min IS NULL THEN 0
                ELSE GREATEST(0,
                       LEAST(v_out_min, (EXTRACT(hour FROM ws.end_time)*60 + EXTRACT(minute FROM ws.end_time))::int)
                     - GREATEST(v_in_min, (EXTRACT(hour FROM ws.start_time)*60 + EXTRACT(minute FROM ws.start_time))::int))
           END AS overlap_min,
           ((EXTRACT(hour FROM ws.end_time)*60 + EXTRACT(minute FROM ws.end_time))::int
          - (EXTRACT(hour FROM ws.start_time)*60 + EXTRACT(minute FROM ws.start_time))::int) AS dur_min
    FROM work_shifts ws WHERE ws.active
  ), c2 AS (
    -- worked = phủ ≥ 50% thời lượng ca. GIỜ hợp lệ = overlap_min/60 (chỉ tính ca hợp lệ).
    SELECT code, name, cong_factor, sort_order, reg,
           (overlap_min >= 0.5 * dur_min AND dur_min > 0) AS worked,
           overlap_min
    FROM c
  )
  SELECT jsonb_agg(jsonb_build_object(
           'code', code, 'name', name, 'congFactor', cong_factor,
           'registered', reg, 'worked', worked, 'valid', (reg AND worked),
           'hours', CASE WHEN reg AND worked THEN round(overlap_min / 60.0, 2) ELSE 0 END,
           'status', CASE WHEN reg AND worked THEN 'valid'
                          WHEN reg THEN 'missed'
                          WHEN worked THEN 'unregistered'
                          ELSE 'off' END
         ) ORDER BY sort_order),
         COALESCE(sum(cong_factor) FILTER (WHERE reg AND worked), 0),
         COALESCE(round(sum(overlap_min) FILTER (WHERE reg AND worked) / 60.0, 2), 0)
    INTO v_shifts, v_cong, v_hours
  FROM c2;

  RETURN jsonb_build_object(
    'employeeId', v_emp,
    'date',       to_char(v_date, 'YYYY-MM-DD'),
    'in',         v_in,
    'out',        v_out,
    'cong',       v_cong,
    'hours',      v_hours,
    'shifts',     COALESCE(v_shifts, '[]'::jsonb)
  );
END;
$$;

-- Trạng thái chấm công của 1 NV hôm nay (giờ VN).
CREATE OR REPLACE FUNCTION attendance_status_for(p_employee_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_last attendance_records%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_next_kind text;
BEGIN
  SELECT * INTO v_last FROM attendance_records
  WHERE employee_id = p_employee_id ORDER BY checked_at DESC LIMIT 1;
  -- Nút kế tiếp: đang trong ca (lần cuối 'in') → 'out'; còn lại → 'in'.
  v_next_kind := CASE WHEN v_last.kind = 'in' THEN 'out' ELSE 'in' END;
  RETURN jsonb_build_object(
    'employeeId', p_employee_id,
    'faceCount', (SELECT count(*) FROM employee_face_descriptors WHERE employee_id = p_employee_id),
    'lastKind', v_last.kind,
    'lastAt', v_last.checked_at,
    'nextKind', v_next_kind,
    -- Ca mà lần chấm KẾ TIẾP (theo v_next_kind) sẽ rơi vào, tính theo GIỜ HIỆN TẠI.
    'currentShift', attendance_shift_at(now(), v_next_kind),
    'todayIn', (SELECT min(checked_at) FROM attendance_records
                WHERE employee_id = p_employee_id AND kind = 'in'
                  AND (checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today),
    'todayOut', (SELECT max(checked_at) FROM attendance_records
                 WHERE employee_id = p_employee_id AND kind = 'out'
                   AND (checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today),
    'todayCount', (SELECT count(*) FROM attendance_records
                   WHERE employee_id = p_employee_id
                     AND (checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today),
    -- Vào/ra từng ca hôm nay (derive ca theo giờ chấm).
    'todayShifts', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('shift', s.code, 'in', si.i, 'out', so.o) ORDER BY s.ord
      ), '[]'::jsonb)
      FROM (VALUES ('ca1', 1), ('ca2', 2), ('ca3', 3)) AS s(code, ord)
      LEFT JOIN LATERAL (
        SELECT min(a.checked_at) AS i FROM attendance_records a
        WHERE a.employee_id = p_employee_id AND a.kind = 'in'
          AND (a.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today
          AND attendance_shift_at(a.checked_at, 'in') = s.code
      ) si ON true
      LEFT JOIN LATERAL (
        SELECT max(a.checked_at) AS o FROM attendance_records a
        WHERE a.employee_id = p_employee_id AND a.kind = 'out'
          AND (a.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today
          AND attendance_shift_at(a.checked_at, 'out') = s.code
      ) so ON true
    ),
    -- Đối chiếu ĐĂNG KÝ ↔ đã làm hôm nay: ca hợp lệ + công (đăng ký công).
    'today', attendance_day_compute(jsonb_build_object('employeeId', p_employee_id, 'date', to_char(v_today, 'YYYY-MM-DD')))
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
