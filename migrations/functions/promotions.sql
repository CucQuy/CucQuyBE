-- ============================================================
-- Domain: promotions — toàn bộ logic ở DB, BE chỉ gọi.
--   CRUD (đồng bộ promotion_products / promotion_categories),
--   engine tính giảm giá (promotion_compute), redeem / release lượt dùng.
-- Quan hệ:
--   - promotions.group_category_id -> categories.id  (gom nhóm BUY_X_GET_Y)
--   - scope = PRODUCTS  -> bảng nối promotion_products(promotion_id, product_id)
--   - scope = CATEGORIES-> bảng nối promotion_categories(promotion_id, category_id)
-- BUY_X_GET_Y gom nhóm theo CATEGORY: 1 sản phẩm thuộc nhóm khi
--   products.category = TÊN của group_category_id  (hoặc products.category_id = group_category_id).
-- ============================================================

-- ─────────────────────── Helpers nội bộ ───────────────────────

-- Gói 1 promotion (kèm productIds/categoryIds từ bảng nối) thành jsonb camelCase.
CREATE OR REPLACE FUNCTION promotion_to_json(p promotions)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',              p.id,
    'name',            COALESCE(p.name, ''),
    'applyMode',       CASE WHEN p.apply_mode = 'CODE' THEN 'CODE' ELSE 'AUTO' END,
    'code',            p.code,
    'discountType',    COALESCE(p.discount_type, 'FIXED'),
    'discountValue',   COALESCE(p.discount_value, 0),
    'maxDiscount',     p.max_discount,
    'groupCategoryId', p.group_category_id,
    'groupBadgeId',    p.group_badge_id,
    'buyQuantity',     p.buy_quantity,
    'getQuantity',     p.get_quantity,
    'startAt',         p.start_at,
    'endAt',           p.end_at,
    'minOrderValue',   COALESCE(p.min_order_value, 0),
    'scope',           COALESCE(p.scope, 'ALL'),
    'productIds',      COALESCE(
                         (SELECT jsonb_agg(pp.product_id ORDER BY pp.product_id)
                          FROM promotion_products pp WHERE pp.promotion_id = p.id),
                         '[]'::jsonb),
    'categoryIds',     COALESCE(
                         (SELECT jsonb_agg(pc.category_id ORDER BY pc.category_id)
                          FROM promotion_categories pc WHERE pc.promotion_id = p.id),
                         '[]'::jsonb),
    'maxUses',         p.max_uses,
    'usedCount',       COALESCE(p.used_count, 0),
    'status',          CASE WHEN p.status = 'inactive' THEN 'inactive' ELSE 'active' END,
    'priority',        COALESCE(p.priority, 0),
    'createdAt',       p.created_at,
    'updatedAt',       p.updated_at,
    'createdBy',       p.created_by
  );
$$;

-- Đồng bộ 2 bảng nối từ payload jsonb (chỉ khi key tương ứng có trong payload).
CREATE OR REPLACE FUNCTION promotion_sync_links(p_id text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- productIds -> promotion_products
  IF p_payload ? 'productIds' THEN
    DELETE FROM promotion_products WHERE promotion_id = p_id;
    INSERT INTO promotion_products (promotion_id, product_id)
    SELECT p_id, v
    FROM jsonb_array_elements_text(COALESCE(p_payload->'productIds', '[]'::jsonb)) AS v
    WHERE COALESCE(v, '') <> ''
    ON CONFLICT DO NOTHING;
  END IF;

  -- categoryIds -> promotion_categories
  IF p_payload ? 'categoryIds' THEN
    DELETE FROM promotion_categories WHERE promotion_id = p_id;
    INSERT INTO promotion_categories (promotion_id, category_id)
    SELECT p_id, v
    FROM jsonb_array_elements_text(COALESCE(p_payload->'categoryIds', '[]'::jsonb)) AS v
    WHERE COALESCE(v, '') <> ''
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- ─────────────────────────── CRUD ───────────────────────────

-- Danh sách (sắp theo priority giảm dần) — trả jsonb array các promotion.
CREATE OR REPLACE FUNCTION promotion_list()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(promotion_to_json(p) ORDER BY COALESCE(p.priority,0) DESC, p.id), '[]'::jsonb)
  FROM promotions p;
$$;

-- Lấy 1 promotion theo id.
CREATE OR REPLACE FUNCTION promotion_get(p_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT promotion_to_json(p) FROM promotions p WHERE p.id = p_id;
$$;

-- Tạo mới. p_input camelCase. Tự sinh id nếu thiếu. Trả {id}.
CREATE OR REPLACE FUNCTION promotion_create(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id   text;
  v_now  text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_code text;
BEGIN
  v_id := NULLIF(p_input->>'id', '');
  IF v_id IS NULL THEN
    v_id := replace(gen_random_uuid()::text, '-', '');
  END IF;

  v_code := NULLIF(btrim(COALESCE(p_input->>'code','')), '');
  IF v_code IS NOT NULL THEN v_code := upper(v_code); END IF;

  INSERT INTO promotions (
    id, name, apply_mode, code, discount_type, discount_value, max_discount,
    group_category_id, group_badge_id, buy_quantity, get_quantity, scope,
    min_order_value, start_at, end_at, max_uses, used_count, status, priority,
    created_by, created_at, updated_at
  ) VALUES (
    v_id,
    NULLIF(p_input->>'name',''),
    CASE WHEN p_input->>'applyMode' = 'CODE' THEN 'CODE' ELSE 'AUTO' END,
    v_code,
    COALESCE(NULLIF(p_input->>'discountType',''), 'FIXED'),
    COALESCE(NULLIF(p_input->>'discountValue','')::numeric, 0),
    NULLIF(p_input->>'maxDiscount','')::numeric,
    NULLIF(p_input->>'groupCategoryId',''),
    NULLIF(p_input->>'groupBadgeId',''),
    NULLIF(p_input->>'buyQuantity','')::int,
    NULLIF(p_input->>'getQuantity','')::int,
    COALESCE(NULLIF(p_input->>'scope',''), 'ALL'),
    COALESCE(NULLIF(p_input->>'minOrderValue','')::numeric, 0),
    NULLIF(p_input->>'startAt',''),
    NULLIF(p_input->>'endAt',''),
    NULLIF(p_input->>'maxUses','')::int,
    0,
    COALESCE(NULLIF(p_input->>'status',''), 'active'),
    COALESCE(NULLIF(p_input->>'priority','')::int, 0),
    NULLIF(p_input->>'createdBy',''),
    v_now, v_now
  );

  PERFORM promotion_sync_links(v_id, p_input);

  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- Cập nhật từng phần (chỉ ghi field có trong payload). Trả {id}.
CREATE OR REPLACE FUNCTION promotion_update(p_id text, p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_now  text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_code text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM promotions WHERE id = p_id) THEN
    RETURN NULL;
  END IF;

  IF p_input ? 'code' THEN
    v_code := NULLIF(btrim(COALESCE(p_input->>'code','')), '');
    IF v_code IS NOT NULL THEN v_code := upper(v_code); END IF;
  END IF;

  UPDATE promotions SET
    name              = CASE WHEN p_input ? 'name'            THEN NULLIF(p_input->>'name','')                       ELSE name END,
    apply_mode        = CASE WHEN p_input ? 'applyMode'       THEN (CASE WHEN p_input->>'applyMode'='CODE' THEN 'CODE' ELSE 'AUTO' END) ELSE apply_mode END,
    code              = CASE WHEN p_input ? 'code'            THEN v_code                                            ELSE code END,
    discount_type     = CASE WHEN p_input ? 'discountType'    THEN COALESCE(NULLIF(p_input->>'discountType',''),'FIXED') ELSE discount_type END,
    discount_value    = CASE WHEN p_input ? 'discountValue'   THEN COALESCE(NULLIF(p_input->>'discountValue','')::numeric,0) ELSE discount_value END,
    max_discount      = CASE WHEN p_input ? 'maxDiscount'     THEN NULLIF(p_input->>'maxDiscount','')::numeric        ELSE max_discount END,
    group_category_id = CASE WHEN p_input ? 'groupCategoryId' THEN NULLIF(p_input->>'groupCategoryId','')            ELSE group_category_id END,
    group_badge_id    = CASE WHEN p_input ? 'groupBadgeId'    THEN NULLIF(p_input->>'groupBadgeId','')               ELSE group_badge_id END,
    buy_quantity      = CASE WHEN p_input ? 'buyQuantity'     THEN NULLIF(p_input->>'buyQuantity','')::int           ELSE buy_quantity END,
    get_quantity      = CASE WHEN p_input ? 'getQuantity'     THEN NULLIF(p_input->>'getQuantity','')::int           ELSE get_quantity END,
    scope             = CASE WHEN p_input ? 'scope'           THEN COALESCE(NULLIF(p_input->>'scope',''),'ALL')      ELSE scope END,
    min_order_value   = CASE WHEN p_input ? 'minOrderValue'   THEN COALESCE(NULLIF(p_input->>'minOrderValue','')::numeric,0) ELSE min_order_value END,
    start_at          = CASE WHEN p_input ? 'startAt'         THEN NULLIF(p_input->>'startAt','')                    ELSE start_at END,
    end_at            = CASE WHEN p_input ? 'endAt'           THEN NULLIF(p_input->>'endAt','')                      ELSE end_at END,
    max_uses          = CASE WHEN p_input ? 'maxUses'         THEN NULLIF(p_input->>'maxUses','')::int               ELSE max_uses END,
    status            = CASE WHEN p_input ? 'status'          THEN COALESCE(NULLIF(p_input->>'status',''),'active')  ELSE status END,
    priority          = CASE WHEN p_input ? 'priority'        THEN COALESCE(NULLIF(p_input->>'priority','')::int,0)  ELSE priority END,
    updated_at        = v_now
  WHERE id = p_id;

  PERFORM promotion_sync_links(p_id, p_input);

  RETURN jsonb_build_object('id', p_id);
END;
$$;

-- Xoá (bảng nối tự CASCADE). Trả {id}.
CREATE OR REPLACE FUNCTION promotion_delete(p_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM promotions WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END;
$$;

-- ─────────────────── Engine tính giảm giá ───────────────────
-- p_input: { items:[{productId,price,quantity}], decorations:[{price,quantity}],
--            surchargeAmount, shippingCost, code, promotionIds:[...] }
-- Trả ComputeResult { subtotal, shippingCost, discountAmount, total,
--                     appliedPromotions[], giftItems[], errors[] }.
-- subtotal = items + decorations + surcharge (phụ thu tổng theo đơn, TRƯỚC giảm).
CREATE OR REPLACE FUNCTION promotion_compute(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_shipping     numeric := COALESCE(NULLIF(p_input->>'shippingCost','')::numeric, 0);
  v_surcharge    numeric := COALESCE(NULLIF(p_input->>'surchargeAmount','')::numeric, 0);
  v_code         text    := NULLIF(upper(btrim(COALESCE(p_input->>'code',''))), '');
  v_selected     text[];
  v_items_total  numeric := 0;
  v_deco_total   numeric := 0;
  v_subtotal     numeric;
  v_now          bigint  := (extract(epoch from now()) * 1000)::bigint; -- ms epoch
  p              promotions%ROWTYPE;
  v_errors       jsonb   := '[]'::jsonb;
  v_reason       text;
  v_amount       numeric;
  v_group_name   text;
  v_chosen       boolean;
  v_by_code      boolean;
  -- gom kết quả
  v_eligible     jsonb   := '[]'::jsonb; -- [{promo jsonb, amount}] cho PERCENT/FIXED/FREE_SHIP
  v_bxgy         jsonb   := '[]'::jsonb; -- [{...}] cho BUY_X_GET_Y
  v_best_value   jsonb;
  v_free_ship    jsonb;
  v_applied      jsonb   := '[]'::jsonb;
  v_discount     numeric := 0;
  v_total        numeric;
  v_code_valid   boolean;
  v_el           jsonb;
BEGIN
  -- selectedPromotionIds
  SELECT COALESCE(array_agg(v), '{}')
  INTO v_selected
  FROM jsonb_array_elements_text(COALESCE(p_input->'promotionIds','[]'::jsonb)) AS v;

  -- subtotal = items + decorations
  SELECT COALESCE(SUM(COALESCE((it->>'price')::numeric,0) * COALESCE((it->>'quantity')::numeric,0)), 0)
  INTO v_items_total
  FROM jsonb_array_elements(COALESCE(p_input->'items','[]'::jsonb)) AS it;

  SELECT COALESCE(SUM(COALESCE((d->>'price')::numeric,0) * COALESCE((d->>'quantity')::numeric,0)), 0)
  INTO v_deco_total
  FROM jsonb_array_elements(COALESCE(p_input->'decorations','[]'::jsonb)) AS d;

  v_subtotal := round(v_items_total + v_deco_total + v_surcharge);

  -- Duyệt từng promotion
  FOR p IN SELECT * FROM promotions LOOP
    IF COALESCE(p.status,'active') <> 'active' THEN CONTINUE; END IF;

    -- Chỉ áp khi CTV chọn HOẶC mã nhập khớp. KHÔNG tự áp.
    v_chosen  := p.id = ANY(v_selected);
    v_by_code := COALESCE(p.apply_mode,'AUTO') = 'CODE' AND v_code IS NOT NULL AND p.code = v_code;
    IF NOT v_chosen AND NOT v_by_code THEN CONTINUE; END IF;

    -- Điều kiện hợp lệ
    v_reason := NULL;
    IF p.start_at IS NOT NULL AND p.start_at <> ''
       AND v_now < (extract(epoch from (p.start_at)::timestamptz) * 1000)::bigint THEN
      v_reason := 'Chương trình chưa bắt đầu.';
    ELSIF p.end_at IS NOT NULL AND p.end_at <> ''
       AND v_now > (extract(epoch from (p.end_at)::timestamptz) * 1000)::bigint THEN
      v_reason := 'Chương trình đã kết thúc.';
    ELSIF COALESCE(p.min_order_value,0) > 0 AND v_subtotal < p.min_order_value THEN
      v_reason := 'Đơn tối thiểu ' || to_char(p.min_order_value, 'FM999G999G999') || 'đ để áp dụng.';
    ELSIF p.max_uses IS NOT NULL AND COALESCE(p.used_count,0) >= p.max_uses THEN
      v_reason := 'Khuyến mãi đã hết lượt.';
    END IF;

    IF v_reason IS NOT NULL THEN
      v_errors := v_errors || to_jsonb(v_reason);
      CONTINUE;
    END IF;

    -- BUY_X_GET_Y: gom nhóm theo category, M món rẻ nhất thành 0đ.
    IF p.discount_type = 'BUY_X_GET_Y' THEN
      v_group_name := NULL;
      IF p.group_category_id IS NOT NULL THEN
        SELECT name INTO v_group_name FROM categories WHERE id = p.group_category_id;
      END IF;

      v_amount := promotion_bxgy_amount(
        p_input->'items',
        p.group_category_id,
        v_group_name,
        COALESCE(NULLIF(p.buy_quantity,0), 1),
        COALESCE(NULLIF(p.get_quantity,0), 1)
      );

      IF v_amount > 0 THEN
        v_bxgy := v_bxgy || jsonb_build_object(
          'promotionId', p.id, 'code', p.code, 'name', COALESCE(p.name,''),
          'type', p.discount_type, 'amount', round(v_amount));
      ELSE
        v_errors := v_errors || to_jsonb('"' || COALESCE(p.name,'') || '": đơn chưa đủ điều kiện mua N tặng M của nhóm.');
      END IF;
      CONTINUE;
    END IF;

    -- PERCENT / FIXED / FREE_SHIP
    v_amount := promotion_value_amount(p, p_input->'items', v_subtotal, v_shipping);
    IF v_amount > 0 THEN
      v_eligible := v_eligible || jsonb_build_object(
        'promotionId', p.id, 'code', p.code, 'name', COALESCE(p.name,''),
        'type', p.discount_type, 'amount', round(v_amount));
    ELSE
      v_errors := v_errors || to_jsonb('"' || COALESCE(p.name,'') || '": không áp dụng cho sản phẩm trong đơn.');
    END IF;
  END LOOP;

  -- Mã nhập nhưng không tồn tại / không active.
  IF v_code IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM promotions WHERE code = v_code AND COALESCE(status,'active') = 'active')
    INTO v_code_valid;
    IF NOT v_code_valid THEN
      v_errors := v_errors || to_jsonb('Mã không hợp lệ hoặc đã hết hạn.'::text);
    END IF;
  END IF;

  -- FREE_SHIP (lớn nhất) + 1 giảm-giá-trị tốt nhất.
  SELECT e INTO v_free_ship
  FROM jsonb_array_elements(v_eligible) AS e
  WHERE e->>'type' = 'FREE_SHIP'
  ORDER BY (e->>'amount')::numeric DESC
  LIMIT 1;

  SELECT e INTO v_best_value
  FROM jsonb_array_elements(v_eligible) AS e
  WHERE e->>'type' <> 'FREE_SHIP'
  ORDER BY (e->>'amount')::numeric DESC
  LIMIT 1;

  -- bestValue + freeShip + mọi BXGY (cộng dồn).
  IF v_best_value IS NOT NULL THEN v_applied := v_applied || v_best_value; END IF;
  IF v_free_ship  IS NOT NULL THEN v_applied := v_applied || v_free_ship;  END IF;
  FOR v_el IN SELECT * FROM jsonb_array_elements(v_bxgy) LOOP
    v_applied := v_applied || v_el;
  END LOOP;

  -- Tổng giảm, không vượt subtotal + ship.
  SELECT COALESCE(SUM((a->>'amount')::numeric), 0)
  INTO v_discount
  FROM jsonb_array_elements(v_applied) AS a;
  v_discount := LEAST(v_discount, v_subtotal + v_shipping);

  v_total := round(v_subtotal + v_shipping - v_discount);

  RETURN jsonb_build_object(
    'subtotal',          v_subtotal,
    'shippingCost',      v_shipping,
    'discountAmount',    round(v_discount),
    'total',             v_total,
    'appliedPromotions', v_applied,
    'giftItems',         '[]'::jsonb,
    'errors',            v_errors
  );
END;
$$;

-- Tiền giảm "mua N tặng M" theo nhóm category: bung từng đơn vị các sản phẩm
-- thuộc nhóm, cứ đủ (N+M) cái thì M cái RẺ NHẤT thành 0đ. Trả tổng tiền giảm.
-- Sản phẩm thuộc nhóm khi products.category = tên nhóm HOẶC products.category_id = group id.
CREATE OR REPLACE FUNCTION promotion_bxgy_amount(
  p_items       jsonb,
  p_group_id    text,
  p_group_name  text,
  p_buy         int,
  p_get         int
)
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_block     int := p_buy + p_get;
  v_units     numeric[];
  v_count     int;
  v_free      int;
  v_sum       numeric := 0;
  i           int;
BEGIN
  IF p_group_id IS NULL AND p_group_name IS NULL THEN
    RETURN 0;
  END IF;

  -- Bung từng đơn vị giá của sản phẩm thuộc nhóm, sắp xếp rẻ nhất trước.
  SELECT array_agg(price ORDER BY price ASC)
  INTO v_units
  FROM (
    SELECT COALESCE((it->>'price')::numeric, 0) AS price
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
    JOIN products pr ON pr.id = (it->>'productId')
    CROSS JOIN generate_series(1, GREATEST(COALESCE((it->>'quantity')::int, 0), 0)) AS g
    WHERE (p_group_name IS NOT NULL AND pr.category = p_group_name)
       OR (p_group_id   IS NOT NULL AND pr.category_id = p_group_id)
  ) u;

  v_count := COALESCE(array_length(v_units, 1), 0);
  IF v_count < v_block THEN RETURN 0; END IF;

  v_free := (v_count / v_block) * p_get; -- chia nguyên
  IF v_free <= 0 THEN RETURN 0; END IF;

  FOR i IN 1 .. v_free LOOP
    v_sum := v_sum + v_units[i];
  END LOOP;

  RETURN round(v_sum);
END;
$$;

-- Tiền giảm cho 1 promo PERCENT / FIXED / FREE_SHIP theo phạm vi (scope).
-- ALL: toàn subtotal; PRODUCTS: tổng dòng có productId trong promotion_products;
-- CATEGORIES: tổng dòng có product.category_id trong promotion_categories.
CREATE OR REPLACE FUNCTION promotion_value_amount(
  p          promotions,
  p_items    jsonb,
  p_subtotal numeric,
  p_shipping numeric
)
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base numeric := 0;
  v_amt  numeric;
BEGIN
  IF p.discount_type = 'FREE_SHIP' THEN
    RETURN round(p_shipping);
  END IF;

  IF COALESCE(p.scope, 'ALL') = 'ALL' THEN
    v_base := p_subtotal;
  ELSIF p.scope = 'PRODUCTS' THEN
    SELECT COALESCE(SUM(COALESCE((it->>'price')::numeric,0) * COALESCE((it->>'quantity')::numeric,0)), 0)
    INTO v_base
    FROM jsonb_array_elements(COALESCE(p_items,'[]'::jsonb)) AS it
    WHERE EXISTS (
      SELECT 1 FROM promotion_products pp
      WHERE pp.promotion_id = p.id AND pp.product_id = (it->>'productId')
    );
  ELSIF p.scope = 'CATEGORIES' THEN
    SELECT COALESCE(SUM(COALESCE((it->>'price')::numeric,0) * COALESCE((it->>'quantity')::numeric,0)), 0)
    INTO v_base
    FROM jsonb_array_elements(COALESCE(p_items,'[]'::jsonb)) AS it
    JOIN products pr ON pr.id = (it->>'productId')
    WHERE EXISTS (
      SELECT 1 FROM promotion_categories pc
      WHERE pc.promotion_id = p.id AND pc.category_id = pr.category_id
    );
  END IF;

  IF v_base <= 0 THEN RETURN 0; END IF;

  IF p.discount_type = 'PERCENT' THEN
    v_amt := (v_base * COALESCE(p.discount_value, 0)) / 100;
    IF p.max_discount IS NOT NULL THEN v_amt := LEAST(v_amt, p.max_discount); END IF;
    RETURN round(v_amt);
  ELSIF p.discount_type = 'FIXED' THEN
    RETURN round(LEAST(COALESCE(p.discount_value, 0), v_base));
  END IF;

  RETURN 0;
END;
$$;

-- ─────────────────── Lượt dùng (redeem / release) ───────────────────
-- p_applied: jsonb array [{promotionId, ...}]. Bỏ qua promo không có promotionId.

-- Tăng used_count (atomic, chặn vượt max_uses).
CREATE OR REPLACE FUNCTION promotion_redeem(p_applied jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
BEGIN
  FOR v_id IN
    SELECT DISTINCT a->>'promotionId'
    FROM jsonb_array_elements(COALESCE(p_applied,'[]'::jsonb)) AS a
    WHERE COALESCE(a->>'promotionId','') <> ''
  LOOP
    UPDATE promotions
    SET used_count = COALESCE(used_count, 0) + 1
    WHERE id = v_id
      AND (max_uses IS NULL OR COALESCE(used_count, 0) < max_uses);
  END LOOP;
END;
$$;

-- Hoàn lại lượt (không xuống dưới 0).
CREATE OR REPLACE FUNCTION promotion_release(p_applied jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
BEGIN
  FOR v_id IN
    SELECT DISTINCT a->>'promotionId'
    FROM jsonb_array_elements(COALESCE(p_applied,'[]'::jsonb)) AS a
    WHERE COALESCE(a->>'promotionId','') <> ''
  LOOP
    UPDATE promotions
    SET used_count = GREATEST(0, COALESCE(used_count, 0) - 1)
    WHERE id = v_id;
  END LOOP;
END;
$$;
