-- ============================================================
-- Domain: orders — MODULE PHỨC TẠP NHẤT. Toàn bộ logic data ở DB, BE chỉ gọi.
-- Port nguyên hành vi orders.service.ts (Firestore) sang Postgres raw SQL.
--
-- Quan hệ (Firestore cũ nhúng mảng -> nay là bảng con, ghi trong transaction):
--   orders (1)─(n) order_items / order_decorations / order_gift_items /
--                  order_applied_promotions / order_history
--   order_history (1)─(n) order_history_changes
--   orders.customer (object cũ) -> cột phẳng customer_name/phone/address/email/
--                  customer_city/customer_country (+ customer_id FK customers).
--
-- Số đơn: order_number = 'ORD-' + (max hiện tại + 1) padded 6 chữ số,
--   mặc định 'ORD-000001'. orders.order_number UNIQUE.
--
-- Khuyến mãi: tạo đơn -> promotion_redeem(applied);
--   sửa đơn -> release(cũ) + redeem(mới); xoá đơn -> release(applied).
--   Số tiền giảm/total tính THẨM QUYỀN qua promotion_compute (không tin FE).
--
-- KHÔNG port (BE wiring sau, service cũ chỉ trả data cho FE tự gọi):
--   - Gửi Zalo (create/update/delete notify) — FE tự gọi từ payload trả về.
--   - order_update trả `changes` + `prevOrder` để FE gửi Zalo update.
-- ============================================================

-- ─────────────────────── Helpers nội bộ ───────────────────────

-- Tên hiển thị 1 user theo uid (như FE getUserByUid): customName||displayName||email||uid.
CREATE OR REPLACE FUNCTION order_creator_name(p_uid text)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_uid,'') = '' THEN ''
    ELSE COALESCE(
      (SELECT COALESCE(NULLIF(u.custom_name,''), NULLIF(u.display_name,''),
                       NULLIF(u.email,''), u.uid)
       FROM users u WHERE u.uid = p_uid),
      p_uid)
  END;
$$;

-- Gói customer (cột phẳng) thành object camelCase như FE mong đợi.
CREATE OR REPLACE FUNCTION order_customer_json(o orders)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',      COALESCE(o.customer_id, ''),
    'name',    COALESCE(o.customer_name, ''),
    'phone',   COALESCE(o.phone, ''),
    'address', COALESCE(o.address, ''),
    'email',   COALESCE(o.email, ''),
    'city',    COALESCE(o.customer_city, ''),
    'country', COALESCE(o.customer_country, '')
  );
$$;

-- items của 1 đơn (bảng con) -> jsonb array camelCase (FE: item.id = bản ghi).
CREATE OR REPLACE FUNCTION order_items_json(p_order_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id',        i.id::text,
      'productId', i.product_id,
      'name',      COALESCE(i.product_name, ''),
      'quantity',  COALESCE(i.quantity, 0),
      'price',     COALESCE(i.unit_price, 0),
      'image',     COALESCE(i.image, '')
    ) ORDER BY i.id),
    '[]'::jsonb)
  FROM order_items i WHERE i.order_id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION order_decorations_json(p_order_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'materialId', d.id::text,
      'name',       COALESCE(d.name, ''),
      'quantity',   COALESCE(d.quantity, 0),
      'price',      COALESCE(d.price, 0)
    ) ORDER BY d.id),
    '[]'::jsonb)
  FROM order_decorations d WHERE d.order_id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION order_gift_items_json(p_order_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'productId', g.product_id,
      'name',      COALESCE(g.name, ''),
      'image',     COALESCE(g.image, ''),
      'quantity',  COALESCE(g.quantity, 0),
      'price',     COALESCE(g.price, 0)
    ) ORDER BY g.id),
    '[]'::jsonb)
  FROM order_gift_items g WHERE g.order_id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION order_applied_promotions_json(p_order_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'promotionId', a.promotion_id,
      'code',        a.code,
      'name',        COALESCE(a.name, ''),
      'type',        a.type,
      'amount',      COALESCE(a.amount, 0)
    ) ORDER BY a.id),
    '[]'::jsonb)
  FROM order_applied_promotions a WHERE a.order_id = p_order_id;
$$;

-- history (kèm changes con) -> jsonb array camelCase.
CREATE OR REPLACE FUNCTION order_history_json(p_order_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'at',     h.at,
      'by',     COALESCE(h.by_name, ''),
      'byUid',  COALESCE(h.by_uid, ''),
      'changes', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
            'field',    COALESCE(c.field, ''),
            'label',    COALESCE(c.label, ''),
            'oldValue', COALESCE(c.old_value, '—'),
            'newValue', COALESCE(c.new_value, '—')
          ) ORDER BY c.id)
         FROM order_history_changes c WHERE c.history_id = h.id),
        '[]'::jsonb)
    ) ORDER BY h.at, h.id),
    '[]'::jsonb)
  FROM order_history h WHERE h.order_id = p_order_id;
$$;

-- Gói 1 order (kèm mọi bảng con) thành jsonb camelCase đầy đủ cho FE.
CREATE OR REPLACE FUNCTION order_to_json(o orders)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',                o.id,
    'orderNumber',       o.order_number,
    'sepayId',           o.sepay_id,
    'customer',          order_customer_json(o),
    'customerName',      COALESCE(o.customer_name, ''),
    'phone',             COALESCE(o.phone, ''),
    'address',           COALESCE(o.address, ''),
    'email',             COALESCE(o.email, ''),
    'items',             order_items_json(o.id),
    'decorations',       order_decorations_json(o.id),
    'subtotal',          COALESCE(o.subtotal, 0),
    'discountAmount',    COALESCE(o.discount_amount, 0),
    'appliedPromotions', order_applied_promotions_json(o.id),
    'giftItems',         order_gift_items_json(o.id),
    'total',             COALESCE(o.total, 0),
    'shippingCost',      COALESCE(o.shipping_cost, 0),
    'status',            o.status,
    'paymentStatus',     o.payment_status,
    'paymentMethod',     o.payment_method,
    'deliveryType',      o.delivery_type,
    'orderDate',         o.order_date,
    'deliveryDate',      o.delivery_date,
    'deliveryTime',      o.delivery_time,
    'note',              COALESCE(o.note, ''),
    'createdByUid',      o.created_by,
    'createdBy',         order_creator_name(o.created_by),
    'updatedBy',         o.updated_by,
    'createdAt',         o.created_at,
    'updatedAt',         o.updated_at,
    'history',           order_history_json(o.id),
    'isTest',            COALESCE(o.is_test, false),
    'commissionStatus',  o.commission_status,
    'commissionPaidAt',  o.commission_paid_at
  );
$$;

-- ─────────────────── Sinh số đơn kế tiếp ───────────────────
-- max(order_number 'ORD-xxxxxx') + 1 padded 6, mặc định 'ORD-000001'.
CREATE OR REPLACE FUNCTION order_next_number()
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_last text;
  v_num  int;
BEGIN
  SELECT order_number INTO v_last
  FROM orders
  WHERE order_number LIKE 'ORD-%'
  ORDER BY order_number DESC
  LIMIT 1;

  IF v_last IS NULL THEN
    RETURN 'ORD-000001';
  END IF;

  v_num := NULLIF(split_part(v_last, '-', 2), '')::int;
  IF v_num IS NULL THEN
    RETURN 'ORD-000001';
  END IF;

  RETURN 'ORD-' || lpad((v_num + 1)::text, 6, '0');
END;
$$;

-- ─────────────────────────── Đọc ───────────────────────────

-- Danh sách đơn (sắp orderNumber desc như FE), mỗi đơn jsonb đầy đủ.
CREATE OR REPLACE FUNCTION order_list()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(order_to_json(o) ORDER BY o.order_number DESC NULLS LAST),
    '[]'::jsonb)
  FROM orders o;
$$;

-- 1 đơn theo id (jsonb đầy đủ) hoặc NULL.
CREATE OR REPLACE FUNCTION order_get(p_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT order_to_json(o) FROM orders o WHERE o.id = p_id;
$$;

-- ─────────────────── Ghi bảng con (nội bộ) ───────────────────
-- Xoá rồi chèn lại toàn bộ bảng con cho 1 đơn (đồng bộ từ payload jsonb).

-- items: payload mảng [{productId|id, name, quantity, price, image}].
CREATE OR REPLACE FUNCTION order_write_items(p_order_id text, p_items jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM order_items WHERE order_id = p_order_id;
  INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, image)
  SELECT
    p_order_id,
    NULLIF(COALESCE(it->>'productId', it->>'id'), ''),
    NULLIF(it->>'name', ''),
    COALESCE(NULLIF(it->>'price','')::numeric, 0),
    COALESCE(NULLIF(it->>'quantity','')::numeric, 0),
    NULLIF(it->>'image', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it;
END;
$$;

CREATE OR REPLACE FUNCTION order_write_decorations(p_order_id text, p_decos jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM order_decorations WHERE order_id = p_order_id;
  INSERT INTO order_decorations (order_id, name, price, quantity)
  SELECT
    p_order_id,
    NULLIF(d->>'name', ''),
    COALESCE(NULLIF(d->>'price','')::numeric, 0),
    COALESCE(NULLIF(d->>'quantity','')::numeric, 0)
  FROM jsonb_array_elements(COALESCE(p_decos, '[]'::jsonb)) AS d;
END;
$$;

CREATE OR REPLACE FUNCTION order_write_gift_items(p_order_id text, p_gifts jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM order_gift_items WHERE order_id = p_order_id;
  INSERT INTO order_gift_items (order_id, product_id, name, image, quantity, price)
  SELECT
    p_order_id,
    NULLIF(g->>'productId', ''),
    NULLIF(g->>'name', ''),
    NULLIF(g->>'image', ''),
    COALESCE(NULLIF(g->>'quantity','')::numeric, 0),
    COALESCE(NULLIF(g->>'price','')::numeric, 0)
  FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::jsonb)) AS g;
END;
$$;

-- applied promotions: payload [{promotionId, code, name, type, amount}].
CREATE OR REPLACE FUNCTION order_write_applied(p_order_id text, p_applied jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM order_applied_promotions WHERE order_id = p_order_id;
  INSERT INTO order_applied_promotions (order_id, promotion_id, code, name, type, amount)
  SELECT
    p_order_id,
    NULLIF(a->>'promotionId', ''),
    NULLIF(a->>'code', ''),
    NULLIF(a->>'name', ''),
    NULLIF(a->>'type', ''),
    COALESCE(NULLIF(a->>'amount','')::numeric, 0)
  FROM jsonb_array_elements(COALESCE(p_applied, '[]'::jsonb)) AS a
  WHERE COALESCE(a->>'promotionId','') <> '';
END;
$$;

-- Thêm 1 history entry + các change con. p_changes: [{field,label,oldValue,newValue}].
-- v_at ISO text -> timestamptz cột at.
CREATE OR REPLACE FUNCTION order_add_history(
  p_order_id text,
  p_by_name  text,
  p_by_uid   text,
  p_changes  jsonb
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_hid bigint;
BEGIN
  IF p_changes IS NULL OR jsonb_array_length(p_changes) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO order_history (order_id, at, by_name, by_uid)
  VALUES (p_order_id, now(), NULLIF(p_by_name,''), NULLIF(p_by_uid,''))
  RETURNING id INTO v_hid;

  INSERT INTO order_history_changes (history_id, field, label, old_value, new_value)
  SELECT
    v_hid,
    COALESCE(c->>'field', ''),
    COALESCE(c->>'label', ''),
    COALESCE(c->>'oldValue', '—'),
    COALESCE(c->>'newValue', '—')
  FROM jsonb_array_elements(COALESCE(p_changes, '[]'::jsonb)) AS c;
END;
$$;

-- ─────────────────────────── Tạo đơn ───────────────────────────
-- p_input camelCase (giống FE addOrder gửi). Chú ý: KHÔNG nhận discount/total
-- của FE — tính THẨM QUYỀN qua promotion_compute. Trả order đã tạo (jsonb).
-- Logic:
--   orderNumber = input.orderNumber || order_next_number()
--   promo = compute(items[map productId], decorations, shippingCost, code, promotionIds)
--   hasItems = #items>0; subtotal/discount/total từ promo nếu hasItems, else input.total
--   ghi orders + bảng con + redeem promo + set commission_status nếu có.
CREATE OR REPLACE FUNCTION order_create(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id       text;
  v_number   text;
  v_cust     jsonb := COALESCE(p_input->'customer', '{}'::jsonb);
  v_items    jsonb := COALESCE(p_input->'items', '[]'::jsonb);
  v_decos    jsonb := COALESCE(p_input->'decorations', '[]'::jsonb);
  v_shipping numeric := COALESCE(NULLIF(p_input->>'shippingCost','')::numeric, 0);
  v_has      boolean;
  v_compute_in jsonb;
  v_promo    jsonb;
  v_subtotal numeric;
  v_discount numeric;
  v_total    numeric;
  v_applied  jsonb;
  v_gifts    jsonb;
  v_cust_id  text;
BEGIN
  v_id := replace(gen_random_uuid()::text, '-', '');
  v_number := COALESCE(NULLIF(p_input->>'orderNumber',''), order_next_number());
  v_has := jsonb_array_length(v_items) > 0;

  -- Map item.id -> productId cho engine (giống service cũ).
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(jsonb_build_object(
       'productId', COALESCE(it->>'productId', it->>'id'),
       'price',     COALESCE(NULLIF(it->>'price','')::numeric, 0),
       'quantity',  COALESCE(NULLIF(it->>'quantity','')::numeric, 0)
     )), '[]'::jsonb),
    'decorations', v_decos,
    'shippingCost', v_shipping,
    'code', p_input->>'appliedPromotionCode',
    'promotionIds', COALESCE(p_input->'appliedPromotionIds', '[]'::jsonb)
  ) INTO v_compute_in
  FROM jsonb_array_elements(v_items) AS it;

  -- Khi không có item, vòng FROM rỗng -> v_compute_in NULL: dựng input rỗng.
  IF v_compute_in IS NULL THEN
    v_compute_in := jsonb_build_object(
      'items', '[]'::jsonb, 'decorations', v_decos, 'shippingCost', v_shipping,
      'code', p_input->>'appliedPromotionCode',
      'promotionIds', COALESCE(p_input->'appliedPromotionIds', '[]'::jsonb));
  END IF;

  v_promo := promotion_compute(v_compute_in);

  IF v_has THEN
    v_subtotal := COALESCE((v_promo->>'subtotal')::numeric, 0);
    v_discount := COALESCE((v_promo->>'discountAmount')::numeric, 0);
    v_total    := COALESCE((v_promo->>'total')::numeric, 0);
    v_applied  := COALESCE(v_promo->'appliedPromotions', '[]'::jsonb);
    v_gifts    := COALESCE(v_promo->'giftItems', '[]'::jsonb);
  ELSE
    v_subtotal := COALESCE(NULLIF(p_input->>'total','')::numeric, 0);
    v_discount := 0;
    v_total    := COALESCE(NULLIF(p_input->>'total','')::numeric, 0);
    v_applied  := COALESCE(v_promo->'appliedPromotions', '[]'::jsonb);
    v_gifts    := '[]'::jsonb;
  END IF;

  -- customer_id chỉ set khi khớp customers.id (FK).
  v_cust_id := NULLIF(v_cust->>'id', '');
  IF v_cust_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id = v_cust_id) THEN
    v_cust_id := NULL;
  END IF;

  INSERT INTO orders (
    id, order_number, order_date, customer_id,
    customer_name, phone, address, email, customer_city, customer_country,
    subtotal, shipping_cost, discount_amount, total,
    payment_status, payment_method, status, delivery_type,
    delivery_date, delivery_time, note, sepay_id,
    commission_status, is_test, created_by, created_at
  ) VALUES (
    v_id, v_number, now(), v_cust_id,
    COALESCE(v_cust->>'name',''), COALESCE(v_cust->>'phone',''),
    COALESCE(v_cust->>'address',''), COALESCE(v_cust->>'email',''),
    NULLIF(v_cust->>'city',''), NULLIF(v_cust->>'country',''),
    v_subtotal, v_shipping, v_discount, v_total,
    COALESCE(NULLIF(p_input->>'paymentStatus',''), 'UNPAID'),
    COALESCE(NULLIF(p_input->>'paymentMethod',''), 'CASH'),
    p_input->>'status',
    COALESCE(NULLIF(p_input->>'deliveryType',''), 'SHIP'),
    NULLIF(p_input->>'deliveryDate',''),
    NULLIF(p_input->>'deliveryTime',''),
    COALESCE(p_input->>'note',''),
    NULLIF(p_input->>'sepayId',''),
    NULLIF(p_input->>'commissionStatus',''),
    COALESCE((p_input->>'isTest')::boolean, false),
    NULLIF(p_input->>'createdBy',''),
    now()
  );

  PERFORM order_write_items(v_id, v_items);
  PERFORM order_write_decorations(v_id, v_decos);
  PERFORM order_write_gift_items(v_id, v_gifts);
  PERFORM order_write_applied(v_id, v_applied);

  -- Trừ lượt dùng khuyến mãi (atomic).
  IF jsonb_array_length(v_applied) > 0 THEN
    PERFORM promotion_redeem(v_applied);
  END IF;

  RETURN order_get(v_id);
END;
$$;

-- ─────────────────────────── Cập nhật đơn ───────────────────────────
-- Check quyền CTV (chỉ sửa đơn của mình) -> raise nếu vi phạm (BE bắt -> 403).
-- Recompute promo thẩm quyền, ghi diff vào history, release(cũ)+redeem(mới).
-- p_user: { uid, role, displayName, email } (camelCase).
-- p_changes: diff đã tính ở BE (port diffOrders) [{field,label,oldValue,newValue}].
-- Trả jsonb: { order: <order sau cập nhật>, changes: [...], prevOrder: <trước> }.
CREATE OR REPLACE FUNCTION order_update(
  p_id      text,
  p_input   jsonb,
  p_user    jsonb,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_prev      jsonb;
  v_existing  orders%ROWTYPE;
  v_cust      jsonb := COALESCE(p_input->'customer', '{}'::jsonb);
  v_items     jsonb := COALESCE(p_input->'items', '[]'::jsonb);
  v_decos     jsonb := COALESCE(p_input->'decorations', '[]'::jsonb);
  v_shipping  numeric := COALESCE(NULLIF(p_input->>'shippingCost','')::numeric, 0);
  v_has       boolean;
  v_compute_in jsonb;
  v_promo     jsonb;
  v_subtotal  numeric;
  v_discount  numeric;
  v_total     numeric;
  v_applied   jsonb;
  v_old_applied jsonb;
  v_role      text := lower(COALESCE(p_user->>'role',''));
  v_uid       text := NULLIF(p_user->>'uid','');
  v_editor    text;
  v_uid_short text;
  v_cust_id   text;
BEGIN
  SELECT * INTO v_existing FROM orders WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- snapshot trước cập nhật (để FE gửi Zalo update).
  v_prev := order_to_json(v_existing);

  -- CTV chỉ được sửa đơn của chính mình.
  IF v_role = 'colaborator' THEN
    IF v_uid IS NULL OR COALESCE(v_existing.created_by,'') = ''
       OR v_existing.created_by <> v_uid THEN
      RAISE EXCEPTION 'ORDER_EDIT_DENIED' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  v_has := jsonb_array_length(v_items) > 0;
  v_old_applied := order_applied_promotions_json(p_id);

  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(jsonb_build_object(
       'productId', COALESCE(it->>'productId', it->>'id'),
       'price',     COALESCE(NULLIF(it->>'price','')::numeric, 0),
       'quantity',  COALESCE(NULLIF(it->>'quantity','')::numeric, 0)
     )), '[]'::jsonb),
    'decorations', v_decos,
    'shippingCost', v_shipping,
    'code', p_input->>'appliedPromotionCode',
    'promotionIds', COALESCE(p_input->'appliedPromotionIds', '[]'::jsonb)
  ) INTO v_compute_in
  FROM jsonb_array_elements(v_items) AS it;

  IF v_compute_in IS NULL THEN
    v_compute_in := jsonb_build_object(
      'items', '[]'::jsonb, 'decorations', v_decos, 'shippingCost', v_shipping,
      'code', p_input->>'appliedPromotionCode',
      'promotionIds', COALESCE(p_input->'appliedPromotionIds', '[]'::jsonb));
  END IF;

  v_promo := promotion_compute(v_compute_in);

  IF v_has THEN
    v_subtotal := COALESCE((v_promo->>'subtotal')::numeric, 0);
    v_discount := COALESCE((v_promo->>'discountAmount')::numeric, 0);
    v_total    := COALESCE((v_promo->>'total')::numeric, 0);
    v_applied  := COALESCE(v_promo->'appliedPromotions', '[]'::jsonb);
  ELSE
    v_subtotal := COALESCE(NULLIF(p_input->>'total','')::numeric, 0);
    v_discount := 0;
    v_total    := COALESCE(NULLIF(p_input->>'total','')::numeric, 0);
    v_applied  := COALESCE(v_promo->'appliedPromotions', '[]'::jsonb);
  END IF;

  -- editor name (như service: displayName||email||User-uid6||Unknown).
  v_uid_short := CASE WHEN v_uid IS NOT NULL THEN 'User-' || left(v_uid, 6) END;
  v_editor := COALESCE(NULLIF(p_user->>'displayName',''), NULLIF(p_user->>'email',''),
                       v_uid_short, 'Unknown');

  v_cust_id := NULLIF(v_cust->>'id', '');
  IF v_cust_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id = v_cust_id) THEN
    v_cust_id := NULL;
  END IF;

  UPDATE orders SET
    customer_id      = v_cust_id,
    customer_name    = COALESCE(v_cust->>'name',''),
    phone            = COALESCE(v_cust->>'phone',''),
    address          = COALESCE(v_cust->>'address',''),
    email            = COALESCE(v_cust->>'email',''),
    customer_city    = NULLIF(v_cust->>'city',''),
    customer_country = NULLIF(v_cust->>'country',''),
    shipping_cost    = v_shipping,
    subtotal         = v_subtotal,
    discount_amount  = v_discount,
    total            = v_total,
    note             = COALESCE(p_input->>'note',''),
    status           = p_input->>'status',
    delivery_date    = CASE WHEN p_input ? 'deliveryDate'
                            THEN NULLIF(p_input->>'deliveryDate','') ELSE delivery_date END,
    delivery_time    = CASE WHEN p_input ? 'deliveryTime'
                            THEN NULLIF(p_input->>'deliveryTime','') ELSE delivery_time END,
    payment_status   = COALESCE(NULLIF(p_input->>'paymentStatus',''), 'UNPAID'),
    payment_method   = COALESCE(NULLIF(p_input->>'paymentMethod',''), 'CASH'),
    sepay_id         = CASE WHEN p_input ? 'sepayId'
                            THEN NULLIF(p_input->>'sepayId','') ELSE sepay_id END,
    is_test          = CASE WHEN p_input ? 'isTest'
                            THEN COALESCE((p_input->>'isTest')::boolean, false) ELSE is_test END,
    delivery_type    = CASE WHEN p_input ? 'deliveryType'
                            THEN p_input->>'deliveryType' ELSE delivery_type END,
    updated_at       = now(),
    updated_by       = CASE WHEN p_changes IS NOT NULL AND jsonb_array_length(p_changes) > 0
                            THEN v_editor ELSE updated_by END
  WHERE id = p_id;

  PERFORM order_write_items(p_id, v_items);
  PERFORM order_write_decorations(p_id, v_decos);
  PERFORM order_write_applied(p_id, v_applied);

  -- Ghi history nếu có thay đổi.
  IF p_changes IS NOT NULL AND jsonb_array_length(p_changes) > 0 THEN
    PERFORM order_add_history(p_id, v_editor, v_uid, p_changes);
  END IF;

  -- Điều chỉnh lượt dùng KM: hoàn lượt bộ cũ, trừ lượt bộ mới (chỉ khi hasItems).
  IF v_has THEN
    IF jsonb_array_length(v_old_applied) > 0 THEN
      PERFORM promotion_release(v_old_applied);
    END IF;
    IF jsonb_array_length(v_applied) > 0 THEN
      PERFORM promotion_redeem(v_applied);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order',     order_get(p_id),
    'changes',   COALESCE(p_changes, '[]'::jsonb),
    'prevOrder', v_prev
  );
END;
$$;

-- ─────────────────────────── Đổi trạng thái ───────────────────────────
-- Tiện ích đổi status + ghi 1 history entry (field 'status').
-- p_user: { uid, displayName, email }. Trả order sau cập nhật.
CREATE OR REPLACE FUNCTION order_update_status(
  p_id     text,
  p_status text,
  p_user   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_old    text;
  v_uid    text := NULLIF(p_user->>'uid','');
  v_editor text;
  v_uid_short text;
BEGIN
  SELECT status INTO v_old FROM orders WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF COALESCE(v_old,'') = COALESCE(p_status,'') THEN
    RETURN order_get(p_id);
  END IF;

  v_uid_short := CASE WHEN v_uid IS NOT NULL THEN 'User-' || left(v_uid, 6) END;
  v_editor := COALESCE(NULLIF(p_user->>'displayName',''), NULLIF(p_user->>'email',''),
                       v_uid_short, 'Unknown');

  UPDATE orders SET
    status     = p_status,
    updated_at = now(),
    updated_by = v_editor
  WHERE id = p_id;

  PERFORM order_add_history(p_id, v_editor, v_uid, jsonb_build_array(
    jsonb_build_object(
      'field', 'status', 'label', 'Trạng thái',
      'oldValue', COALESCE(NULLIF(v_old,''), '—'),
      'newValue', COALESCE(NULLIF(p_status,''), '—'))));

  RETURN order_get(p_id);
END;
$$;

-- ─────────────────────────── Xoá đơn ───────────────────────────
-- Trả snapshot prevOrder (để FE gửi Zalo delete), hoàn lượt KM, xoá (bảng con CASCADE).
CREATE OR REPLACE FUNCTION order_delete(p_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_o       orders%ROWTYPE;
  v_prev    jsonb;
  v_applied jsonb;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('id', p_id, 'prevOrder', NULL);
  END IF;

  v_prev := order_to_json(v_o);
  v_applied := order_applied_promotions_json(p_id);

  DELETE FROM orders WHERE id = p_id;  -- bảng con CASCADE

  IF jsonb_array_length(v_applied) > 0 THEN
    PERFORM promotion_release(v_applied);
  END IF;

  RETURN jsonb_build_object('id', p_id, 'prevOrder', v_prev);
END;
$$;
