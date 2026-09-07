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

-- ==================== ZALO FEATURES (096/097) ====================

-- Danh mục chức năng thông báo + cờ bật/tắt + nhóm nào nhận (màn "Chức năng" tự
-- sinh theo đây, không hardcode ở code nữa).
CREATE OR REPLACE FUNCTION zalo_features_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'feature', f.feature,
      'label', f.label,
      'description', COALESCE(f.description, ''),
      'kind', f.kind,
      'section', f.section,
      'template', COALESCE(f.template, ''),
      'composer', f.composer,
      'schedulable', (f.composer IS NOT NULL OR f.kind = 'template'),
      'builtin', f.builtin,
      'enabled', f.enabled,
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
    ) ORDER BY f.sort_order, f.label),
    '[]'::jsonb
  )
  FROM zalo_features f;
$$;

-- Bật/tắt: p_data = {"features": [{"feature": "...", "enabled": true}]}.
-- Chỉ đụng feature CÓ trong payload, không tạo mới (tạo dùng zalo_feature_upsert).
CREATE OR REPLACE FUNCTION zalo_features_save(p_data jsonb, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE zalo_features f
     SET enabled = COALESCE((x->>'enabled')::boolean, f.enabled),
         updated_at = now(),
         updated_by = p_by
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_data->'features') = 'array'
                THEN p_data->'features' ELSE '[]'::jsonb END
         ) AS x
   WHERE f.feature = btrim(x->>'feature');

  RETURN zalo_features_get();
END;
$$;

-- Tạo/sửa 1 chức năng TỰ SOẠN từ UI. p_data: {feature?, label, description?, section?,
-- template, enabled?}. feature trống → sinh slug từ label (ASCII, không dấu).
-- KHÔNG cho sửa/tạo kind='builtin' (nội dung do code soạn).
CREATE OR REPLACE FUNCTION zalo_feature_upsert(p_data jsonb, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_key   text := NULLIF(btrim(COALESCE(p_data->>'feature','')), '');
  v_label text := NULLIF(btrim(COALESCE(p_data->>'label','')), '');
  v_slug  text;
BEGIN
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'Thiếu tên chức năng';
  END IF;

  IF v_key IS NULL THEN
    -- slug: bỏ dấu tiếng Việt → [a-z0-9_], tránh đụng key builtin.
    v_slug := lower(regexp_replace(unaccent_vi(v_label), '[^a-zA-Z0-9]+', '_', 'g'));
    v_slug := btrim(v_slug, '_');
    IF v_slug = '' THEN v_slug := 'tin'; END IF;
    v_key := v_slug;
    WHILE EXISTS (SELECT 1 FROM zalo_features WHERE feature = v_key) LOOP
      v_key := v_slug || '_' || floor(random() * 1000)::int;
    END LOOP;
  ELSE
    IF EXISTS (SELECT 1 FROM zalo_features WHERE feature = v_key AND builtin) THEN
      RAISE EXCEPTION 'Chức năng "%" là mặc định của hệ thống, không sửa được ở đây', v_key;
    END IF;
  END IF;

  INSERT INTO zalo_features (feature, label, description, kind, section, template, enabled, builtin, sort_order, updated_by)
  VALUES (
    v_key,
    v_label,
    NULLIF(btrim(COALESCE(p_data->>'description','')), ''),
    'template',
    COALESCE(NULLIF(btrim(COALESCE(p_data->>'section','')), ''), 'Tự soạn'),
    COALESCE(p_data->>'template', ''),
    COALESCE((p_data->>'enabled')::boolean, true),
    false,
    500,
    p_by
  )
  ON CONFLICT (feature) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    section = EXCLUDED.section,
    template = EXCLUDED.template,
    enabled = EXCLUDED.enabled,
    updated_at = now(),
    updated_by = EXCLUDED.updated_by;

  RETURN zalo_features_get();
END;
$$;

-- Xoá chức năng tự soạn: dọn luôn khỏi nhóm + lịch nhắc để không còn tham chiếu chết.
CREATE OR REPLACE FUNCTION zalo_feature_delete(p_feature text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_key text := btrim(COALESCE(p_feature, ''));
BEGIN
  IF EXISTS (SELECT 1 FROM zalo_features WHERE feature = v_key AND builtin) THEN
    RAISE EXCEPTION 'Chức năng "%" là mặc định của hệ thống, không xoá được', v_key;
  END IF;
  DELETE FROM notification_schedules WHERE type = v_key;
  UPDATE zalo_groups SET notify_features = array_remove(notify_features, v_key)
   WHERE v_key = ANY (notify_features);
  DELETE FROM zalo_features WHERE feature = v_key;
  RETURN zalo_features_get();
END;
$$;

-- Chức năng có đang BẬT không (không có hàng = bật, để feature lạ không bị chặn oan).
CREATE OR REPLACE FUNCTION zalo_feature_enabled(p_feature text)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT f.enabled FROM zalo_features f WHERE f.feature = btrim(p_feature)),
    true
  );
$$;

-- Bỏ dấu tiếng Việt (không cần extension unaccent) → dùng để sinh slug feature.
CREATE OR REPLACE FUNCTION unaccent_vi(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(
    COALESCE(p_text, ''),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydAAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD'
  );
$$;

-- Số tiền VND có dấu phân cách nghìn (1250000 → 1.250.000).
CREATE OR REPLACE FUNCTION vnd_fmt(p_amount numeric)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(to_char(COALESCE(p_amount, 0), 'FM999G999G999G999'), ',', '.');
$$;

/**
 * Biến dùng được trong tin TỰ SOẠN ({{ten_bien}}). Thêm biến mới = thêm 1 key ở đây,
 * UI tự hiện trong danh sách chèn biến (đọc từ zalo_template_var_list()).
 * p_date = ngày tham chiếu yyyy-mm-dd (giờ VN, lịch nhắc truyền vào).
 */
CREATE OR REPLACE FUNCTION zalo_template_vars(p_date text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH d AS (
    SELECT COALESCE(NULLIF(btrim(COALESCE(p_date, '')), ''),
                    to_char((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD')) AS today
  ),
  today_orders AS (
    SELECT count(*)::int AS cnt,
           COALESCE(sum(o.total), 0) AS revenue,
           COALESCE(sum(o.total) FILTER (WHERE o.payment_status IS DISTINCT FROM 'PAID'), 0) AS unpaid_amt
      FROM orders o, d
     WHERE o.delivery_date = d.today
       AND COALESCE(o.is_test, false) = false
       AND o.status IS DISTINCT FROM 'CANCELLED'
       AND o.status IS DISTINCT FROM 'RETURNED'
  ),
  tomorrow_orders AS (
    SELECT count(*)::int AS cnt
      FROM orders o, d
     WHERE o.delivery_date = to_char(to_date(d.today, 'YYYY-MM-DD') + 1, 'YYYY-MM-DD')
       AND COALESCE(o.is_test, false) = false
       AND o.status IS DISTINCT FROM 'CANCELLED'
       AND o.status IS DISTINCT FROM 'RETURNED'
  )
  SELECT jsonb_build_object(
    'ngay',                    to_char(to_date(d.today, 'YYYY-MM-DD'), 'DD/MM/YYYY'),
    'thu',                     vn_weekday_short(to_date(d.today, 'YYYY-MM-DD')),
    'gio',                     to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
    'so_don_hom_nay',          t.cnt::text,
    'doanh_thu_hom_nay',       vnd_fmt(t.revenue),
    'tien_chua_thu_hom_nay',   vnd_fmt(t.unpaid_amt),
    'so_don_can_giao_mai',     m.cnt::text,
    'so_don_cho_xu_ly',        COALESCE(order_counts()->>'pending', '0'),
    'so_don_chua_thanh_toan',  COALESCE(order_counts()->>'unpaid', '0')
  )
  FROM d, today_orders t, tomorrow_orders m;
$$;

-- Danh sách biến + mô tả để UI hiện nút "chèn biến" (không hardcode ở FE).
CREATE OR REPLACE FUNCTION zalo_template_var_list()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('key', 'ngay', 'label', 'Ngày (dd/mm/yyyy)'),
    jsonb_build_object('key', 'thu', 'label', 'Thứ trong tuần'),
    jsonb_build_object('key', 'gio', 'label', 'Giờ gửi (HH:MM)'),
    jsonb_build_object('key', 'so_don_hom_nay', 'label', 'Số đơn giao hôm nay'),
    jsonb_build_object('key', 'doanh_thu_hom_nay', 'label', 'Doanh thu hôm nay'),
    jsonb_build_object('key', 'tien_chua_thu_hom_nay', 'label', 'Tiền còn chưa thu hôm nay'),
    jsonb_build_object('key', 'so_don_can_giao_mai', 'label', 'Số đơn cần giao ngày mai'),
    jsonb_build_object('key', 'so_don_cho_xu_ly', 'label', 'Số đơn đang chờ xử lý'),
    jsonb_build_object('key', 'so_don_chua_thanh_toan', 'label', 'Số đơn chưa thanh toán')
  );
$$;

-- Nội dung tin TỰ SOẠN: render template của 1 chức năng với biến {{...}}.
-- Trả NULL nếu không phải chức năng tự soạn / template rỗng.
CREATE OR REPLACE FUNCTION zalo_feature_render(p_feature text, p_date text)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tpl  text;
  v_vars jsonb;
  v_k    text;
  v_out  text;
BEGIN
  SELECT NULLIF(btrim(COALESCE(template, '')), '')
    INTO v_tpl
    FROM zalo_features
   WHERE feature = btrim(COALESCE(p_feature, '')) AND kind = 'template';
  IF v_tpl IS NULL THEN RETURN NULL; END IF;

  v_vars := zalo_template_vars(p_date);
  v_out := v_tpl;
  FOR v_k IN SELECT jsonb_object_keys(v_vars) LOOP
    v_out := replace(v_out, '{{' || v_k || '}}', COALESCE(v_vars->>v_k, ''));
  END LOOP;
  RETURN v_out;
END;
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
