-- ============================================================
-- Domain: configurations — screen visibility / shipping / zalo.
-- Toàn bộ logic data ở DB, BE chỉ gọi. Trả jsonb đúng shape FE/Firestore cũ.
-- Bảng đã tách:
--   screen_visibility(route, visible)
--   shipping_config(id, over_fee, over_label, shop_origin jsonb) + shipping_tiers(max_km, fee, label, sort_order)
--   zalo_config(id, main_*) + zalo_groups + zalo_group_members (FK users)
-- (Các bảng không có cột updatedAt/updatedBy → field đó bỏ qua trong output.)
-- ============================================================

-- ==================== SCREEN VISIBILITY ====================

-- Trả { screenVisibility: {route: bool}, screenRoles: {route: [role,..]} }.
--   screenRoles chỉ chứa route CÓ override role (roles IS NOT NULL); route khác → FE dùng mặc định.
CREATE OR REPLACE FUNCTION screen_visibility_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'screenVisibility',
    COALESCE(
      (SELECT jsonb_object_agg(route, COALESCE(visible, true)) FROM screen_visibility),
      '{}'::jsonb
    ),
    'screenRoles',
    COALESCE(
      (SELECT jsonb_object_agg(route, roles) FROM screen_visibility WHERE roles IS NOT NULL),
      '{}'::jsonb
    )
  );
$$;

-- Ghi đè toàn bộ map screen visibility + role override.
--   p_map:   {"/path": true, ...} (visible !== false → true).
--   p_roles: {"/path": ["admin","staff"], ...} — mảng rỗng/thiếu → NULL (dùng mặc định hard-code).
CREATE OR REPLACE FUNCTION screen_visibility_save(p_map jsonb, p_roles jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  -- xoá route không còn gửi lên
  DELETE FROM screen_visibility
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_each(COALESCE(p_map, '{}'::jsonb)) AS e(route, val)
    WHERE e.route = screen_visibility.route AND COALESCE(e.route, '') <> ''
  );

  -- upsert: visible = (val !== false); roles = mảng role nếu có (>0 phần tử), else NULL.
  INSERT INTO screen_visibility (route, visible, roles)
  SELECT e.route, (e.val <> 'false'::jsonb),
    CASE WHEN jsonb_typeof(p_roles->e.route) = 'array' AND jsonb_array_length(p_roles->e.route) > 0
         THEN p_roles->e.route ELSE NULL END
  FROM jsonb_each(COALESCE(p_map, '{}'::jsonb)) AS e(route, val)
  WHERE COALESCE(e.route, '') <> ''
  ON CONFLICT (route) DO UPDATE
    SET visible = EXCLUDED.visible, roles = EXCLUDED.roles;

  RETURN screen_visibility_get();
END;
$$;

-- ==================== NETWORK GUARD (per-screen) ====================

-- Danh sách route YÊU CẦU mạng được duyệt (chỉ route enabled).
CREATE OR REPLACE FUNCTION network_guard_get()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(route ORDER BY route) FROM screen_network_guard WHERE enabled),
    '[]'::jsonb);
$$;

-- Ghi đè toàn bộ: p_routes = ["/orders", "/attendance", ...] (mảng route bật guard).
CREATE OR REPLACE FUNCTION network_guard_save(p_routes jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM screen_network_guard;
  INSERT INTO screen_network_guard (route, enabled)
  SELECT DISTINCT value, true
  FROM jsonb_array_elements_text(COALESCE(p_routes, '[]'::jsonb)) AS value
  WHERE COALESCE(value, '') <> '';
  RETURN network_guard_get();
END;
$$;

-- Trạng thái mạng cho 1 IP (dùng CHUNG danh sách attendance_allowed_networks):
-- {configured: có dải nào active?, allowed: IP này có thuộc dải nào?, ip}.
CREATE OR REPLACE FUNCTION network_ip_status(p_ip text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_configured boolean := EXISTS(SELECT 1 FROM attendance_allowed_networks WHERE active);
  v_allowed boolean := false;
BEGIN
  BEGIN
    v_allowed := EXISTS(
      SELECT 1 FROM attendance_allowed_networks
      WHERE active AND p_ip::inet <<= ip_cidr);
  EXCEPTION WHEN others THEN v_allowed := false;
  END;
  RETURN jsonb_build_object('configured', v_configured, 'allowed', v_allowed, 'ip', p_ip);
END;
$$;

-- ==================== SHIPPING ====================

-- Trả {shopOrigin, tiers[], overFee, overLabel}. Không có row → trả jsonb 'null'
-- để service áp DEFAULT_SHIPPING_CONFIG (giữ nguyên hành vi fallback cũ).
CREATE OR REPLACE FUNCTION shipping_config_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM shipping_config WHERE id = 'shipping') THEN 'null'::jsonb
    ELSE (
      SELECT jsonb_build_object(
        -- shop_origin có thể bị lưu dạng JSON string (double-encoded) → unwrap về object
        'shopOrigin', CASE
          WHEN jsonb_typeof(sc.shop_origin) = 'string' THEN (sc.shop_origin #>> '{}')::jsonb
          WHEN jsonb_typeof(sc.shop_origin) = 'object' THEN sc.shop_origin
          ELSE '{}'::jsonb
        END,
        'overFee', COALESCE(sc.over_fee, 0),
        'overLabel', COALESCE(sc.over_label, ''),
        'tiers', COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('maxKm', t.max_km, 'fee', t.fee, 'label', t.label)
                  ORDER BY t.sort_order, t.max_km)
           FROM shipping_tiers t),
          '[]'::jsonb
        )
      )
      FROM shipping_config sc WHERE sc.id = 'shipping'
    )
  END;
$$;

-- Lưu shipping config từ jsonb {shopOrigin, tiers[{maxKm,fee,label}], overFee, overLabel}.
-- Tiers: lọc maxKm > 0, sort theo maxKm; ghi lại sort_order theo thứ tự đã sort.
CREATE OR REPLACE FUNCTION shipping_config_save(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  p_data := COALESCE(p_data, '{}'::jsonb);

  INSERT INTO shipping_config (id, over_fee, over_label, shop_origin)
  VALUES (
    'shipping',
    COALESCE(NULLIF(p_data->>'overFee','')::numeric, 0),
    NULLIF(p_data->>'overLabel',''),
    CASE
      WHEN jsonb_typeof(p_data->'shopOrigin') = 'object' THEN p_data->'shopOrigin'
      WHEN jsonb_typeof(p_data->'shopOrigin') = 'string' THEN (p_data->'shopOrigin' #>> '{}')::jsonb
      ELSE '{}'::jsonb
    END
  )
  ON CONFLICT (id) DO UPDATE SET
    over_fee = EXCLUDED.over_fee,
    over_label = EXCLUDED.over_label,
    shop_origin = EXCLUDED.shop_origin;

  -- replace tiers (lọc maxKm > 0, sort theo maxKm)
  DELETE FROM shipping_tiers;
  INSERT INTO shipping_tiers (max_km, fee, label, sort_order)
  SELECT t.max_km, t.fee, t.label, (row_number() OVER (ORDER BY t.max_km) - 1)::int
  FROM (
    SELECT
      COALESCE(NULLIF(x->>'maxKm','')::numeric, 0) AS max_km,
      COALESCE(NULLIF(x->>'fee','')::numeric, 0)   AS fee,
      NULLIF(x->>'label','')                       AS label
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_data->'tiers') = 'array' THEN p_data->'tiers' ELSE '[]'::jsonb END
    ) AS x
  ) t
  WHERE t.max_km > 0;

  RETURN shipping_config_get();
END;
$$;

-- ==================== PAYMENT ACCOUNTS (multi-account) ====================
-- Mô hình: nhiều tài khoản nhận tiền, tối đa 1 active. QR đơn dùng tài khoản active.
-- Bỏ payment_config_get/save cũ (single-row).

-- Liệt kê tất cả tài khoản → jsonb array. Sắp active trước rồi created_at desc.
-- Mỗi item {id, bankCode, accountNumber, accountHolder, qrTemplate, isActive, createdAt}.
CREATE OR REPLACE FUNCTION payment_accounts_list()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
              'id', a.id,
              'bankCode', a.bank_code,
              'accountNumber', a.account_number,
              'accountHolder', a.account_holder,
              'qrTemplate', a.qr_template,
              'isActive', a.is_active,
              'createdAt', a.created_at
            ) ORDER BY a.is_active DESC, a.created_at DESC)
     FROM payment_accounts a),
    '[]'::jsonb
  );
$$;
-- Tạo tài khoản mới từ jsonb {bankCode, accountNumber, accountHolder, qrTemplate}.
-- Nếu là tài khoản ĐẦU TIÊN (bảng đang rỗng) → set is_active=true. Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_create(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_first boolean;
BEGIN
  p_data := COALESCE(p_data, '{}'::jsonb);

  IF COALESCE(p_data->>'bankCode','') = ''
     OR COALESCE(p_data->>'accountNumber','') = ''
     OR COALESCE(p_data->>'accountHolder','') = '' THEN
    RAISE EXCEPTION 'bankCode, accountNumber, accountHolder are required';
  END IF;

  v_first := NOT EXISTS (SELECT 1 FROM payment_accounts);

  INSERT INTO payment_accounts (bank_code, account_number, account_holder, qr_template, is_active)
  VALUES (
    p_data->>'bankCode',
    p_data->>'accountNumber',
    p_data->>'accountHolder',
    COALESCE(NULLIF(p_data->>'qrTemplate',''), 'compact'),
    v_first
  );

  RETURN payment_accounts_list();
END;
$$;

-- Set tài khoản p_id làm active, các tài khoản khác false (atomic). Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_set_active(p_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_accounts WHERE id = p_id) THEN
    RAISE EXCEPTION 'payment account % not found', p_id;
  END IF;

  -- tắt active trước (tránh đụng partial unique index), rồi bật cái cần.
  UPDATE payment_accounts SET is_active = false WHERE is_active AND id <> p_id;
  UPDATE payment_accounts SET is_active = true WHERE id = p_id;

  RETURN payment_accounts_list();
END;
$$;

-- Xoá tài khoản p_id. Nếu nó đang active và còn tài khoản khác → set cái mới nhất làm active.
-- Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_delete(p_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_was_active boolean;
  v_next_id text;
BEGIN
  SELECT is_active INTO v_was_active FROM payment_accounts WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN payment_accounts_list();
  END IF;

  DELETE FROM payment_accounts WHERE id = p_id;

  IF v_was_active THEN
    SELECT id INTO v_next_id FROM payment_accounts ORDER BY created_at DESC LIMIT 1;
    IF v_next_id IS NOT NULL THEN
      UPDATE payment_accounts SET is_active = true WHERE id = v_next_id;
    END IF;
  END IF;

  RETURN payment_accounts_list();
END;
$$;

-- Dọn function single-row cũ (đổi mô hình).
DROP FUNCTION IF EXISTS payment_config_get();
DROP FUNCTION IF EXISTS payment_config_save(jsonb);

-- ==================== ZALO GROUPS ====================

-- Trả {groups[{id,name,zaloGroupId,memberUids[],notifyOn*,updateFieldWhitelist[]}], mainGroupId, mainNotifyOn*, mainUpdateFieldWhitelist}.
CREATE OR REPLACE FUNCTION zalo_config_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'groups', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'id', g.id,
                'name', COALESCE(g.name, ''),
                'zaloGroupId', COALESCE(g.zalo_group_id, ''),
                'memberUids', COALESCE(
                  (SELECT jsonb_agg(m.user_uid ORDER BY m.user_uid)
                   FROM zalo_group_members m WHERE m.group_id = g.id),
                  '[]'::jsonb
                ),
                'notifyOnCreate', COALESCE(g.notify_on_create, true),
                'notifyOnUpdate', COALESCE(g.notify_on_update, true),
                'notifyOnDelete', COALESCE(g.notify_on_delete, true),
                'notifyOnPayment', COALESCE(g.notify_on_payment, false),
                'updateFieldWhitelist', COALESCE(to_jsonb(g.update_field_whitelist), '[]'::jsonb)
              ) ORDER BY g.id)
       FROM zalo_groups g),
      '[]'::jsonb
    ),
    'mainGroupId', COALESCE((SELECT main_group_id FROM zalo_config WHERE id = 'zalo'), ''),
    'paymentGroupId', COALESCE((SELECT payment_group_id FROM zalo_config WHERE id = 'zalo'), ''),
    'mainNotifyOnCreate', COALESCE((SELECT main_notify_on_create FROM zalo_config WHERE id = 'zalo'), true),
    'mainNotifyOnUpdate', COALESCE((SELECT main_notify_on_update FROM zalo_config WHERE id = 'zalo'), true),
    'mainNotifyOnDelete', COALESCE((SELECT main_notify_on_delete FROM zalo_config WHERE id = 'zalo'), true),
    'mainUpdateFieldWhitelist', COALESCE(
      (SELECT to_jsonb(main_update_field_whitelist) FROM zalo_config WHERE id = 'zalo'),
      '[]'::jsonb
    )
  );
$$;

-- Lưu cấu hình zalo groups từ jsonb payload (groups + main settings tuỳ chọn).
-- - groups: ghi đè toàn bộ; mỗi group có id (gen nếu thiếu), member_uids → bảng nối (chỉ uid có trong users).
-- - main*: chỉ cập nhật field nào CÓ trong payload (key tồn tại); các field khác giữ nguyên.
-- - đồng bộ users.zalo_ctv_group_chat_id theo membership (clear nếu không thuộc group nào có zaloGroupId).
CREATE OR REPLACE FUNCTION zalo_config_save(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_uid_chat jsonb;
BEGIN
  p_data := COALESCE(p_data, '{}'::jsonb);

  -- ----- upsert zalo_config (main settings; chỉ field có trong payload) -----
  INSERT INTO zalo_config (id) VALUES ('zalo') ON CONFLICT (id) DO NOTHING;

  IF p_data ? 'mainGroupId' THEN
    UPDATE zalo_config SET main_group_id = btrim(COALESCE(p_data->>'mainGroupId','')) WHERE id = 'zalo';
  END IF;
  IF p_data ? 'paymentGroupId' THEN
    UPDATE zalo_config SET payment_group_id = btrim(COALESCE(p_data->>'paymentGroupId','')) WHERE id = 'zalo';
  END IF;
  IF p_data ? 'mainNotifyOnCreate' THEN
    UPDATE zalo_config SET main_notify_on_create = (p_data->'mainNotifyOnCreate')::boolean WHERE id = 'zalo';
  END IF;
  IF p_data ? 'mainNotifyOnUpdate' THEN
    UPDATE zalo_config SET main_notify_on_update = (p_data->'mainNotifyOnUpdate')::boolean WHERE id = 'zalo';
  END IF;
  IF p_data ? 'mainNotifyOnDelete' THEN
    UPDATE zalo_config SET main_notify_on_delete = (p_data->'mainNotifyOnDelete')::boolean WHERE id = 'zalo';
  END IF;
  IF p_data ? 'mainUpdateFieldWhitelist' THEN
    UPDATE zalo_config SET main_update_field_whitelist = (
      SELECT COALESCE(array_agg(s), '{}'::text[])
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_data->'mainUpdateFieldWhitelist') = 'array'
             THEN p_data->'mainUpdateFieldWhitelist' ELSE '[]'::jsonb END
      ) AS s
      WHERE COALESCE(s,'') <> ''
    ) WHERE id = 'zalo';
  END IF;

  -- ----- replace groups -----
  -- normalize: gán id nếu thiếu, lọc item object
  CREATE TEMP TABLE _grp ON COMMIT DROP AS
  SELECT
    COALESCE(NULLIF(x->>'id',''), 'grp_' || md5(random()::text || clock_timestamp()::text)) AS id,
    COALESCE(x->>'name', '')                  AS name,
    COALESCE(x->>'zaloGroupId', '')           AS zalo_group_id,
    (COALESCE((x->>'notifyOnCreate')::boolean, true)) AS notify_on_create,
    (COALESCE((x->>'notifyOnUpdate')::boolean, true)) AS notify_on_update,
    (COALESCE((x->>'notifyOnDelete')::boolean, true)) AS notify_on_delete,
    (COALESCE((x->>'notifyOnPayment')::boolean, false)) AS notify_on_payment,
    (SELECT COALESCE(array_agg(s), '{}'::text[])
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(x->'updateFieldWhitelist') = 'array' THEN x->'updateFieldWhitelist' ELSE '[]'::jsonb END
       ) AS s WHERE COALESCE(s,'') <> '') AS update_field_whitelist,
    CASE WHEN jsonb_typeof(x->'memberUids') = 'array' THEN x->'memberUids' ELSE '[]'::jsonb END AS member_uids
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_data->'groups') = 'array' THEN p_data->'groups' ELSE '[]'::jsonb END
  ) AS x
  WHERE jsonb_typeof(x) = 'object';

  -- xoá group không còn (members cascade)
  DELETE FROM zalo_groups WHERE id NOT IN (SELECT id FROM _grp);

  -- upsert groups
  INSERT INTO zalo_groups (id, name, zalo_group_id, notify_on_create, notify_on_update, notify_on_delete, notify_on_payment, update_field_whitelist)
  SELECT id, name, zalo_group_id, notify_on_create, notify_on_update, notify_on_delete, notify_on_payment, update_field_whitelist FROM _grp
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    zalo_group_id = EXCLUDED.zalo_group_id,
    notify_on_create = EXCLUDED.notify_on_create,
    notify_on_update = EXCLUDED.notify_on_update,
    notify_on_delete = EXCLUDED.notify_on_delete,
    notify_on_payment = EXCLUDED.notify_on_payment,
    update_field_whitelist = EXCLUDED.update_field_whitelist;

  -- replace members (chỉ uid có trong users → FK an toàn, tự bỏ uid lạ)
  DELETE FROM zalo_group_members;
  INSERT INTO zalo_group_members (group_id, user_uid)
  SELECT DISTINCT g.id, u.uid
  FROM _grp g
  CROSS JOIN LATERAL jsonb_array_elements_text(g.member_uids) AS uid(uid)
  JOIN users u ON u.uid = uid.uid
  WHERE COALESCE(uid.uid, '') <> ''
  ON CONFLICT (group_id, user_uid) DO NOTHING;

  -- ----- sync users.zalo_ctv_group_chat_id theo membership -----
  -- map uid → zaloGroupId (group có zalo_group_id khác rỗng); uid không thuộc → null
  SELECT COALESCE(jsonb_object_agg(uid, chat), '{}'::jsonb) INTO v_uid_chat
  FROM (
    SELECT DISTINCT ON (m.user_uid) m.user_uid AS uid, btrim(g.zalo_group_id) AS chat
    FROM zalo_group_members m
    JOIN zalo_groups g ON g.id = m.group_id
    WHERE COALESCE(btrim(g.zalo_group_id), '') <> ''
    ORDER BY m.user_uid, g.id
  ) s;

  UPDATE users u SET zalo_ctv_group_chat_id = NULLIF(v_uid_chat->>u.uid, '');

  RETURN zalo_config_get();
END;
$$;

-- CTV uid có thuộc nhóm zalo nào (có zaloGroupId) không → trả bool.
-- Non-CTV / user không tồn tại / đã có zalo_ctv_group_chat_id → true.
CREATE OR REPLACE FUNCTION zalo_collaborator_has_group(p_uid text)
RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  IF COALESCE(p_uid, '') = '' THEN
    RETURN true;
  END IF;

  SELECT * INTO v_user FROM users WHERE uid = p_uid;
  IF NOT FOUND THEN
    RETURN true;
  END IF;
  IF v_user.role IS DISTINCT FROM 'colaborator' THEN
    RETURN true;
  END IF;
  IF COALESCE(btrim(v_user.zalo_ctv_group_chat_id), '') <> '' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM zalo_group_members m
    JOIN zalo_groups g ON g.id = m.group_id
    WHERE m.user_uid = p_uid AND COALESCE(btrim(g.zalo_group_id), '') <> ''
  );
END;
$$;
