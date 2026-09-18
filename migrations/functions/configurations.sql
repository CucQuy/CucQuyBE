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
-- Mỗi item {id, bankCode, accountNumber, accountHolder, qrTemplate, isActive, isTracked, createdAt}.
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
              'isTracked', a.is_tracked,
              -- 099: 'receive' = TK nhận tiền khách · 'spend' = TK chi hoá đơn.
              'purpose', a.purpose,
              'createdAt', a.created_at
            ) ORDER BY a.purpose, a.is_active DESC, a.created_at DESC)
     FROM payment_accounts a),
    '[]'::jsonb
  );
$$;
-- Tạo tài khoản mới từ jsonb {bankCode, accountNumber, accountHolder, qrTemplate, purpose}.
-- purpose: 'receive' (mặc định, TK nhận tiền khách) | 'spend' (TK chi hoá đơn) — 099.
-- TK ĐẦU TIÊN của purpose đó → set is_active=true (mỗi purpose có 1 TK chính riêng).
-- Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_create(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_purpose text;
  v_first boolean;
BEGIN
  p_data := COALESCE(p_data, '{}'::jsonb);

  IF COALESCE(p_data->>'bankCode','') = ''
     OR COALESCE(p_data->>'accountNumber','') = ''
     OR COALESCE(p_data->>'accountHolder','') = '' THEN
    RAISE EXCEPTION 'bankCode, accountNumber, accountHolder are required';
  END IF;

  v_purpose := COALESCE(NULLIF(p_data->>'purpose',''), 'receive');
  IF v_purpose NOT IN ('receive', 'spend') THEN
    RAISE EXCEPTION 'purpose phải là receive hoặc spend';
  END IF;

  v_first := NOT EXISTS (SELECT 1 FROM payment_accounts WHERE purpose = v_purpose);

  INSERT INTO payment_accounts (
    bank_code, account_number, account_holder, qr_template, is_active, purpose
  )
  VALUES (
    p_data->>'bankCode',
    p_data->>'accountNumber',
    p_data->>'accountHolder',
    COALESCE(NULLIF(p_data->>'qrTemplate',''), 'compact'),
    v_first,
    v_purpose
  );

  RETURN payment_accounts_list();
END;
$$;

-- Set tài khoản p_id làm active TRONG PURPOSE của nó (atomic) — 099: mỗi purpose có
-- 1 TK chính riêng (1 TK nhận tiền cho QR đơn + 1 TK chi cho hoá đơn), nên chỉ tắt
-- active của các TK CÙNG purpose. Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_set_active(p_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_purpose text;
BEGIN
  SELECT purpose INTO v_purpose FROM payment_accounts WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment account % not found', p_id;
  END IF;

  -- tắt active trước (tránh đụng partial unique index), rồi bật cái cần.
  UPDATE payment_accounts
    SET is_active = false
    WHERE is_active AND purpose = v_purpose AND id <> p_id;
  -- TK chính (nhận hoặc chi) buộc phải vào sổ để đối soát → bật luôn tracking (076).
  UPDATE payment_accounts SET is_active = true, is_tracked = true WHERE id = p_id;

  RETURN payment_accounts_list();
END;
$$;

-- Bật/tắt tracking tài khoản p_id (migration 076): tắt → giao dịch SePay của TK này vẫn
-- được ghi nhưng gắn is_test=true → ra khỏi Sổ giao dịch/đối soát. TK đang active KHÔNG
-- được tắt tracking — TK nhận chính đang nhận tiền đơn, TK chi chính đang chi hoá đơn,
-- cả hai đều phải vào sổ để đối soát (099). Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_set_tracked(p_id text, p_tracked boolean)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_accounts WHERE id = p_id) THEN
    RAISE EXCEPTION 'payment account % not found', p_id;
  END IF;

  IF NOT COALESCE(p_tracked, false)
     AND EXISTS (SELECT 1 FROM payment_accounts WHERE id = p_id AND is_active) THEN
    RAISE EXCEPTION 'không thể tắt tracking tài khoản đang dùng (nhận tiền / chi hoá đơn)';
  END IF;

  UPDATE payment_accounts SET is_tracked = COALESCE(p_tracked, false) WHERE id = p_id;

  RETURN payment_accounts_list();
END;
$$;

-- Đổi MỤC ĐÍCH tài khoản p_id (099): 'receive' (nhận tiền khách, QR đơn trỏ vào TK nhận
-- đang active) ↔ 'spend' (chi hoá đơn, nhận tiền dồn cuối ngày từ TK nhận).
-- Đổi purpose có thể đụng partial unique index (mỗi purpose 1 TK active) → nếu purpose đích
-- đã có TK active thì TK này chuyển sang KHÔNG active; nếu purpose đích chưa có TK nào
-- active thì nó thành TK chính luôn (+ bật tracking để vào sổ đối soát).
-- Chặn đổi purpose của TK NHẬN đang active khi vẫn còn TK nhận khác → tránh tiệm bị mất
-- TK nhận tiền đơn giữa giờ (muốn đổi thì chọn TK nhận khác làm chính trước).
-- Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_set_purpose(p_id text, p_purpose text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_cur_purpose text;
  v_was_active boolean;
  v_target_has_active boolean;
BEGIN
  IF COALESCE(p_purpose, '') NOT IN ('receive', 'spend') THEN
    RAISE EXCEPTION 'purpose phải là receive hoặc spend';
  END IF;

  SELECT purpose, is_active INTO v_cur_purpose, v_was_active
    FROM payment_accounts WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment account % not found', p_id;
  END IF;

  IF v_cur_purpose = p_purpose THEN
    RETURN payment_accounts_list();
  END IF;

  IF v_cur_purpose = 'receive' AND v_was_active
     AND EXISTS (SELECT 1 FROM payment_accounts
                 WHERE purpose = 'receive' AND id <> p_id) THEN
    RAISE EXCEPTION 'chọn tài khoản nhận tiền khác làm chính trước khi đổi mục đích TK này';
  END IF;

  v_target_has_active := EXISTS (
    SELECT 1 FROM payment_accounts WHERE purpose = p_purpose AND is_active AND id <> p_id
  );

  UPDATE payment_accounts
    SET purpose   = p_purpose,
        is_active = NOT v_target_has_active,
        -- TK chính (nhận hoặc chi) buộc phải vào sổ để đối soát (076).
        is_tracked = CASE WHEN v_target_has_active THEN is_tracked ELSE true END
    WHERE id = p_id;

  RETURN payment_accounts_list();
END;
$$;

-- Xoá tài khoản p_id. Nếu nó đang active và còn TK khác CÙNG purpose → set cái mới nhất
-- của purpose đó làm active. Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_delete(p_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_was_active boolean;
  v_purpose text;
  v_next_id text;
BEGIN
  SELECT is_active, purpose INTO v_was_active, v_purpose
    FROM payment_accounts WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN payment_accounts_list();
  END IF;

  DELETE FROM payment_accounts WHERE id = p_id;

  IF v_was_active THEN
    -- Chỉ đề cử TK CÙNG purpose (099) — xoá TK nhận không được biến TK chi thành TK nhận.
    SELECT id INTO v_next_id
      FROM payment_accounts WHERE purpose = v_purpose
      ORDER BY created_at DESC LIMIT 1;
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

-- Trả {groups[{id,name,zaloGroupId,memberUids[],features[],updateFieldWhitelist[]}], customerNotify*}.
-- 095: mỗi nhóm tự khai TÍNH NĂNG thông báo nó nhận (features) — không còn khái niệm
-- "nhóm chính"/"nhóm thanh toán" (main_group_id/payment_group_id đã ngừng dùng).
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
                -- Tính năng thông báo gán cho nhóm (095) — thay 4 cờ notify_on_* cũ.
                'features', COALESCE(to_jsonb(g.notify_features), '[]'::jsonb),
                'updateFieldWhitelist', COALESCE(to_jsonb(g.update_field_whitelist), '[]'::jsonb)
              ) ORDER BY g.id)
       FROM zalo_groups g),
      '[]'::jsonb
    ),
    -- Thông báo Zalo cho KHÁCH HÀNG (084): bật/tắt, chiến dịch KM chèn vào tin, hạn mức tin/ngày.
    'customerNotifyEnabled', COALESCE((SELECT customer_notify_enabled FROM zalo_config WHERE id = 'zalo'), false),
    'customerNotifyPromotionId', COALESCE((SELECT customer_notify_promotion_id FROM zalo_config WHERE id = 'zalo'), ''),
    'customerNotifyDailyLimit', COALESCE((SELECT customer_notify_daily_limit FROM zalo_config WHERE id = 'zalo'), 40)
  );
$$;

-- ==================== ZALO FEATURE FLAGS (096) ====================

-- Danh sách chức năng thông báo + đang bật/tắt + nhóm nào đang nhận (để màn
-- "Chức năng" hiện luôn, khỏi gọi 2 API). Chức năng chưa có hàng cờ = coi như BẬT.
CREATE OR REPLACE FUNCTION zalo_features_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'feature', f.feature,
      'enabled', COALESCE(f.enabled, true),
      'updatedAt', f.updated_at,
      'updatedBy', f.updated_by,
      'groups', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('name', COALESCE(g.name, ''), 'zaloGroupId', g.zalo_group_id)
                  ORDER BY g.name)
           FROM zalo_groups g
          WHERE COALESCE(btrim(g.zalo_group_id), '') <> ''
            AND f.feature = ANY (g.notify_features)),
        '[]'::jsonb
      )
    ) ORDER BY f.feature),
    '[]'::jsonb
  )
  FROM zalo_notify_flags f;
$$;

-- Bật/tắt chức năng: p_data = {"features": [{"feature": "...", "enabled": true}]}.
-- Chỉ ghi những feature CÓ trong payload (không xoá/không reset cái khác).
CREATE OR REPLACE FUNCTION zalo_features_save(p_data jsonb, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO zalo_notify_flags (feature, enabled, updated_at, updated_by)
  SELECT btrim(x->>'feature'),
         COALESCE((x->>'enabled')::boolean, true),
         now(),
         p_by
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_data->'features') = 'array'
                THEN p_data->'features' ELSE '[]'::jsonb END
         ) AS x
   WHERE COALESCE(btrim(x->>'feature'), '') <> ''
  ON CONFLICT (feature) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    updated_at = now(),
    updated_by = EXCLUDED.updated_by;

  RETURN zalo_features_get();
END;
$$;

-- Chức năng có đang bật không (chưa có hàng cờ = bật). ZaloService gọi trước khi gửi.
CREATE OR REPLACE FUNCTION zalo_feature_enabled(p_feature text)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT f.enabled FROM zalo_notify_flags f WHERE f.feature = btrim(p_feature)),
    true
  );
$$;

-- ID nhóm Zalo (zalo_group_id) của các nhóm được gán tính năng thông báo p_feature.
-- BE gọi hàm này để quyết định gửi vào đâu thay vì đọc main_group_id/payment_group_id.
CREATE OR REPLACE FUNCTION zalo_group_ids_for_feature(p_feature text)
RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT btrim(g.zalo_group_id)), '{}'::text[])
    FROM zalo_groups g
   WHERE COALESCE(btrim(g.zalo_group_id), '') <> ''
     AND btrim(COALESCE(p_feature, '')) <> ''
     AND btrim(p_feature) = ANY (g.notify_features);
$$;

-- Lưu cấu hình zalo groups từ jsonb payload (groups + main settings tuỳ chọn).
-- - groups: ghi đè toàn bộ; mỗi group có id (gen nếu thiếu), features[] = tính năng thông
--   báo nhóm nhận, member_uids → bảng nối (chỉ uid có trong users).
-- - customerNotify*: chỉ cập nhật field nào CÓ trong payload (key tồn tại).
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

  IF p_data ? 'customerNotifyEnabled' THEN
    UPDATE zalo_config SET customer_notify_enabled = COALESCE((p_data->>'customerNotifyEnabled')::boolean, false) WHERE id = 'zalo';
  END IF;
  IF p_data ? 'customerNotifyPromotionId' THEN
    UPDATE zalo_config SET customer_notify_promotion_id = NULLIF(btrim(COALESCE(p_data->>'customerNotifyPromotionId','')), '') WHERE id = 'zalo';
  END IF;
  IF p_data ? 'customerNotifyDailyLimit' THEN
    UPDATE zalo_config SET customer_notify_daily_limit = GREATEST(0, COALESCE((p_data->>'customerNotifyDailyLimit')::int, 40)) WHERE id = 'zalo';
  END IF;

  -- ----- replace groups -----
  -- normalize: gán id nếu thiếu, lọc item object
  CREATE TEMP TABLE _grp ON COMMIT DROP AS
  SELECT
    COALESCE(NULLIF(x->>'id',''), 'grp_' || md5(random()::text || clock_timestamp()::text)) AS id,
    COALESCE(x->>'name', '')                  AS name,
    COALESCE(x->>'zaloGroupId', '')           AS zalo_group_id,
    (SELECT COALESCE(array_agg(DISTINCT s), '{}'::text[])
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(x->'features') = 'array' THEN x->'features' ELSE '[]'::jsonb END
       ) AS s WHERE COALESCE(s,'') <> '') AS notify_features,
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
  INSERT INTO zalo_groups (id, name, zalo_group_id, notify_features, update_field_whitelist)
  SELECT id, name, zalo_group_id, notify_features, update_field_whitelist FROM _grp
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    zalo_group_id = EXCLUDED.zalo_group_id,
    notify_features = EXCLUDED.notify_features,
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

-- ─────────────── MỤC TIÊU DOANH THU (092) ───────────────
CREATE OR REPLACE FUNCTION revenue_goals_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'monthlyTarget',  COALESCE(g.monthly_target, 0),
    'dailyMin',       COALESCE(g.daily_min, 0),
    'dailyExpected',  COALESCE(g.daily_expected, 0),
    'updatedAt',      g.updated_at,
    'updatedBy',      COALESCE(g.updated_by, '')
  ) FROM revenue_goals g WHERE g.id = 'goals';
$$;

-- Chỉ ghi field nào được gửi (patch), để sửa 1 ô không xoá 2 ô kia.
CREATE OR REPLACE FUNCTION revenue_goals_save(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO revenue_goals (id) VALUES ('goals') ON CONFLICT (id) DO NOTHING;
  UPDATE revenue_goals SET
    monthly_target = CASE WHEN p_data ? 'monthlyTarget'
                          THEN GREATEST(0, COALESCE((p_data->>'monthlyTarget')::numeric, 0))
                          ELSE monthly_target END,
    daily_min      = CASE WHEN p_data ? 'dailyMin'
                          THEN GREATEST(0, COALESCE((p_data->>'dailyMin')::numeric, 0))
                          ELSE daily_min END,
    daily_expected = CASE WHEN p_data ? 'dailyExpected'
                          THEN GREATEST(0, COALESCE((p_data->>'dailyExpected')::numeric, 0))
                          ELSE daily_expected END,
    updated_by     = COALESCE(NULLIF(p_data->>'updatedBy',''), updated_by),
    updated_at     = now()
  WHERE id = 'goals';
  RETURN revenue_goals_get();
END;
$$;
