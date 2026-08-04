-- ============================================================
-- Domain: users — đọc/ghi hồ sơ user (bảng public.users).
-- Auth vẫn do Firebase Auth lo (firebase-auth.guard); ở đây chỉ data.
-- PK = uid (text). created_at / last_login_at là TEXT (ISO string).
-- ============================================================

-- Liệt kê tất cả user.
CREATE OR REPLACE FUNCTION user_list()
RETURNS SETOF users
LANGUAGE sql STABLE AS $$
  SELECT * FROM users ORDER BY created_at NULLS FIRST, uid;
$$;

-- Lấy 1 user theo uid (rỗng/null → không trả dòng nào).
CREATE OR REPLACE FUNCTION user_get(p_uid text)
RETURNS SETOF users
LANGUAGE sql STABLE AS $$
  SELECT * FROM users WHERE uid = p_uid AND COALESCE(p_uid,'') <> '';
$$;

-- Lấy 1 user theo email (rỗng/null → không trả dòng nào).
CREATE OR REPLACE FUNCTION user_get_by_email(p_email text)
RETURNS SETOF users
LANGUAGE sql STABLE AS $$
  SELECT * FROM users
  WHERE email = p_email AND COALESCE(p_email,'') <> ''
  LIMIT 1;
$$;

-- Lưu/cập nhật user ngay sau đăng nhập.
-- p_data: jsonb {uid,email,displayName,photoURL} (camelCase, lấy từ token + body FE).
-- - Nếu đã tồn tại theo uid HOẶC email → chỉ cập nhật last_login_at, trả về bản ghi đó.
-- - Nếu chưa tồn tại → tạo mới: status='pending', role='colaborator',
--   created_at = last_login_at = now() ISO.
CREATE OR REPLACE FUNCTION user_save(p_data jsonb)
RETURNS SETOF users
LANGUAGE plpgsql AS $$
DECLARE
  v_uid   text := NULLIF(p_data->>'uid','');
  v_email text := NULLIF(p_data->>'email','');
  v_now   text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_existing users%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN; -- không có uid → không làm gì
  END IF;

  -- Tìm bản ghi đã tồn tại theo uid trước, rồi tới email (case-insensitive để tránh
  -- tạo trùng user khi email lưu khác hoa/thường với token).
  SELECT * INTO v_existing FROM users WHERE uid = v_uid;
  IF NOT FOUND AND v_email IS NOT NULL THEN
    SELECT * INTO v_existing FROM users WHERE lower(email) = lower(v_email) LIMIT 1;
  END IF;

  IF v_existing.uid IS NOT NULL THEN
    -- đã tồn tại → chỉ cập nhật last_login_at
    UPDATE users SET last_login_at = v_now::timestamptz WHERE uid = v_existing.uid;
    RETURN QUERY SELECT * FROM users WHERE uid = v_existing.uid;
  ELSE
    -- tạo mới
    RETURN QUERY
    INSERT INTO users (
      uid, email, display_name, photo_url, custom_name,
      status, role, zalo_ctv_group_chat_id, created_at, last_login_at
    ) VALUES (
      v_uid,
      v_email,
      NULLIF(p_data->>'displayName',''),
      NULLIF(p_data->>'photoURL',''),
      NULL,
      'pending',
      'colaborator',
      NULL,
      v_now::timestamptz,
      v_now::timestamptz
    )
    RETURNING *;
  END IF;
END;
$$;

-- Cập nhật status của 1 user.
CREATE OR REPLACE FUNCTION user_update_status(p_uid text, p_status text)
RETURNS void
LANGUAGE sql AS $$
  UPDATE users SET status = p_status WHERE uid = p_uid;
$$;

-- Cập nhật tên gợi nhớ (custom_name).
CREATE OR REPLACE FUNCTION user_update_custom_name(p_uid text, p_custom_name text)
RETURNS void
LANGUAGE sql AS $$
  UPDATE users SET custom_name = p_custom_name WHERE uid = p_uid;
$$;

-- Cập nhật role của 1 user.
CREATE OR REPLACE FUNCTION user_update_role(p_uid text, p_role text)
RETURNS void
LANGUAGE sql AS $$
  UPDATE users SET role = p_role WHERE uid = p_uid;
$$;

-- Đồng bộ zalo_ctv_group_chat_id cho mọi user theo membership group Zalo.
-- p_map: jsonb object { "<uid>": "<zaloGroupId>", ... } (chỉ chứa uid thuộc group).
-- User không có trong map → set NULL (clear).
CREATE OR REPLACE FUNCTION user_sync_zalo_groups(p_map jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users u
  SET zalo_ctv_group_chat_id = NULLIF(p_map->>u.uid, '');
END;
$$;
