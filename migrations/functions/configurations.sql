-- ============================================================
-- Domain: configurations — screen visibility / shipping / zalo.
-- Toàn bộ logic data ở DB, BE chỉ gọi. Trả jsonb đúng shape FE/Firestore cũ.
-- Bảng đã tách:
--   screen_visibility(route, visible)
--   shipping_config(id, over_fee, over_label, shop_origin jsonb) + shipping_tiers(max_km, fee, label, sort_order)
--   zalo_config(id, main_*) + zalo_groups
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
-- Số dư hiện tại của 1 tài khoản (102) = số dư đã chốt + tiền vào − tiền ra của các
-- giao dịch GHI NHẬN SAU mốc chốt. Bỏ giao dịch test. Khớp TK theo account_number HOẶC
-- sub_account (TK ảo BIDV bắn số ảo ở account_number, số của tiệm nằm ở sub_account).
--
-- Mốc so theo `created_at` (lúc hệ thống NHẬN webhook), KHÔNG theo `transaction_date`
-- (giờ ngân hàng ghi) — 3 lý do:
--   1. Chốt số dư = gõ con số đang thấy trên app ngân hàng, tức là đã bao gồm mọi giao
--      dịch hệ thống biết tới thời điểm đó → chỉ được cộng thêm cái ĐẾN SAU.
--   2. Webhook về trễ / ngân hàng ghi lùi giờ vẫn được tính, không bị rơi mất.
--   3. created_at là timestamptz thật, không dính chuyện transaction_date là text giờ VN
--      trong khi DB chạy UTC.
CREATE OR REPLACE FUNCTION payment_account_balance(p_id text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pa.opening_balance, 0) + COALESCE((
    SELECT SUM(CASE WHEN t.transfer_type = 'out' THEN -t.transfer_amount ELSE t.transfer_amount END)
    FROM transactions t
    WHERE COALESCE(t.is_test, false) = false
      AND pa.account_number IN (NULLIF(TRIM(COALESCE(t.account_number, '')), ''),
                                NULLIF(TRIM(COALESCE(t.sub_account, '')), ''))
      AND (pa.opening_balance_at IS NULL OR t.created_at > pa.opening_balance_at)
  ), 0)
  FROM payment_accounts pa
  WHERE pa.id = p_id;
$$;

-- Chốt lại số dư tài khoản p_id theo số đang thấy trên app ngân hàng (102):
-- ghi số dư mới + đóng mốc thời gian = now() → mọi sai lệch tích luỹ trước đó bị bỏ qua,
-- từ giờ chỉ cộng/trừ giao dịch mới. Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_set_opening(p_id text, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_accounts WHERE id = p_id) THEN
    RAISE EXCEPTION 'payment account % not found', p_id;
  END IF;

  UPDATE payment_accounts
     SET opening_balance    = COALESCE(p_amount, 0),
         opening_balance_at = now()
   WHERE id = p_id;

  RETURN payment_accounts_list();
END;
$$;

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
              -- 100: 'hkd' = TK hộ kinh doanh (nhận tiền khách) · 'personal' = TK cá nhân (chi).
              'kind', a.kind,
              -- 102: số dư đã chốt + số dư hiện tại (chốt + giao dịch sau mốc).
              'openingBalance', a.opening_balance,
              'openingBalanceAt', a.opening_balance_at,
              'balance', payment_account_balance(a.id),
              'createdAt', a.created_at
            ) ORDER BY (a.kind = 'none'), a.kind, a.created_at DESC)
     FROM payment_accounts a),
    '[]'::jsonb
  );
$$;
-- Tạo tài khoản mới từ jsonb {bankCode, accountNumber, accountHolder, qrTemplate, kind}.
-- kind: 'none' (mặc định — chỉ lưu vào danh sách) | 'hkd' | 'personal' (101).
-- Gán 'hkd'/'personal' cho TK mới thì TK cũ cùng loại tự rớt về 'none' (mỗi loại 1 TK).
-- Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_create(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
BEGIN
  p_data := COALESCE(p_data, '{}'::jsonb);

  IF COALESCE(p_data->>'bankCode','') = ''
     OR COALESCE(p_data->>'accountNumber','') = ''
     OR COALESCE(p_data->>'accountHolder','') = '' THEN
    RAISE EXCEPTION 'bankCode, accountNumber, accountHolder are required';
  END IF;

  v_kind := COALESCE(NULLIF(p_data->>'kind',''), 'none');
  IF v_kind NOT IN ('hkd', 'personal', 'none') THEN
    RAISE EXCEPTION 'kind phải là hkd, personal hoặc none';
  END IF;

  -- Mỗi loại thật chỉ 1 TK → hạ TK cũ cùng loại về 'none' trước khi chèn (tránh đụng
  -- unique index payment_accounts_one_per_kind_idx).
  IF v_kind <> 'none' THEN
    UPDATE payment_accounts SET kind = 'none', is_active = false WHERE kind = v_kind;
  END IF;

  INSERT INTO payment_accounts (
    bank_code, account_number, account_holder, qr_template, is_active, kind
  )
  VALUES (
    p_data->>'bankCode',
    p_data->>'accountNumber',
    p_data->>'accountHolder',
    COALESCE(NULLIF(p_data->>'qrTemplate',''), 'compact'),
    v_kind <> 'none',
    v_kind
  );

  RETURN payment_accounts_list();
END;
$$;

-- Bật/tắt GHI NHẬN GIAO DỊCH của tài khoản p_id (076, đổi nghĩa ở 100): tắt → webhook
-- SePay của TK này bị BỎ QUA, không lưu giao dịch nào. TK đã gán loại (HKD / cá nhân)
-- KHÔNG được tắt — tiền đơn và hoá đơn chạy qua đó, phải có giao dịch để đối soát.
-- Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_set_tracked(p_id text, p_tracked boolean)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_accounts WHERE id = p_id) THEN
    RAISE EXCEPTION 'payment account % not found', p_id;
  END IF;

  IF NOT COALESCE(p_tracked, false)
     AND EXISTS (SELECT 1 FROM payment_accounts WHERE id = p_id AND kind <> 'none') THEN
    RAISE EXCEPTION 'không thể tắt ghi nhận tài khoản HKD / cá nhân đang chọn';
  END IF;

  UPDATE payment_accounts SET is_tracked = COALESCE(p_tracked, false) WHERE id = p_id;

  RETURN payment_accounts_list();
END;
$$;

-- Gán LOẠI cho tài khoản p_id (101) — đây là thao tác DUY NHẤT để chọn tài khoản:
--   'hkd'      → TK hộ kinh doanh (khách CK vào, QR đơn dùng TK này)
--   'personal' → TK cá nhân (nhận dồn cuối ngày rồi chi hoá đơn)
--   'none'     → không dùng (chỉ nằm trong danh sách để tra cứu)
-- Mỗi loại thật CHỈ 1 TK: gán 'hkd' cho TK này thì TK 'hkd' cũ tự rớt về 'none'
-- (atomic, làm trước khi set để không đụng unique index).
-- TK được gán 'hkd'/'personal' thì bật luôn ghi nhận giao dịch — tiền đơn/hoá đơn chạy
-- qua đó, không ghi thì không đối soát được.
-- Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_set_kind(p_id text, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(p_kind, '') NOT IN ('hkd', 'personal', 'none') THEN
    RAISE EXCEPTION 'kind phải là hkd, personal hoặc none';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM payment_accounts WHERE id = p_id) THEN
    RAISE EXCEPTION 'payment account % not found', p_id;
  END IF;

  IF p_kind <> 'none' THEN
    UPDATE payment_accounts
       SET kind = 'none', is_active = false
     WHERE kind = p_kind AND id <> p_id;
  END IF;

  UPDATE payment_accounts
     SET kind       = p_kind,
         is_active  = (p_kind <> 'none'),
         is_tracked = CASE WHEN p_kind <> 'none' THEN true ELSE is_tracked END
   WHERE id = p_id;

  RETURN payment_accounts_list();
END;
$$;

-- Xoá tài khoản p_id. Xoá TK 'hkd'/'personal' thì loại đó trống — người dùng tự gán TK
-- khác (101: không tự đề cử, tránh im lặng đổi TK nhận tiền). Trả payment_accounts_list().
CREATE OR REPLACE FUNCTION payment_account_delete(p_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM payment_accounts WHERE id = p_id;
  RETURN payment_accounts_list();
END;
$$;

-- Dọn function single-row cũ (đổi mô hình).
DROP FUNCTION IF EXISTS payment_config_get();
DROP FUNCTION IF EXISTS payment_config_save(jsonb);

-- ==================== ZALO GROUPS ====================

-- Trả {groups[{id,name,zaloGroupId,features[],updateFieldWhitelist[]}], customerNotify*}.
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
--   báo nhóm nhận.
-- - customerNotify*: chỉ cập nhật field nào CÓ trong payload (key tồn tại).
CREATE OR REPLACE FUNCTION zalo_config_save(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
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
       ) AS s WHERE COALESCE(s,'') <> '') AS update_field_whitelist
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_data->'groups') = 'array' THEN p_data->'groups' ELSE '[]'::jsonb END
  ) AS x
  WHERE jsonb_typeof(x) = 'object';

  -- xoá group không còn
  DELETE FROM zalo_groups WHERE id NOT IN (SELECT id FROM _grp);

  -- upsert groups
  INSERT INTO zalo_groups (id, name, zalo_group_id, notify_features, update_field_whitelist)
  SELECT id, name, zalo_group_id, notify_features, update_field_whitelist FROM _grp
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    zalo_group_id = EXCLUDED.zalo_group_id,
    notify_features = EXCLUDED.notify_features,
    update_field_whitelist = EXCLUDED.update_field_whitelist;

  RETURN zalo_config_get();
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
