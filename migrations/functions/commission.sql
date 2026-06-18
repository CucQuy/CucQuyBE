-- ============================================================
-- Domain: commission (hoa hồng CTV) — toàn bộ logic tính toán ở DB.
-- Port nguyên công thức từ commission.service.ts + commission.types.ts.
--
-- Công thức (giữ 100% hành vi bản FE-Firestore):
--   1. groupOfProduct(product): nếu costPrice>=0 thì margin=(price-costPrice)/price,
--      profit<=0 -> không có nhóm; ngược lại findGroupForMargin(margin).
--      Nếu không có costPrice -> nhóm sort_order nhỏ nhất.
--   2. findGroupForMargin(margin): nhóm đầu tiên (theo sort_order) thoả
--      margin>=min_margin AND (margin<max_margin OR max_margin>=1);
--      fallback nhóm cuối.
--   3. Gom theo THÁNG (delivery_date) -> qtyByGroup (tổng quantity mỗi nhóm,
--      bỏ đơn CANCELLED/RETURNED) -> rateForQuantity(group, qty) = tier có
--      min_qty lớn nhất <= qty (duyệt tăng dần, lấy tier cuối thoả).
--   4. itemCommissionAtRate(price,costPrice,fallbackRate,rate):
--      price<=0 -> 0; có costPrice>=0: profit=price-costPrice, profit<=0 -> 0,
--      else profit*rate; không costPrice -> price*fallbackRate.
--      amount mỗi item = perUnit * quantity.
--   5. totalSales += max(total - shippingCost, 0) (bỏ đơn huỷ).
--      paid/pending theo commission_status.
-- ============================================================

-- ── Helper: nhóm hoa hồng của 1 sản phẩm (theo price/cost_price) ──────────
-- Trả về commission_groups.id, hoặc NULL nếu không có nhóm (profit<=0).
CREATE OR REPLACE FUNCTION commission_group_for_product(
  p_price numeric,
  p_cost_price numeric
)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_margin numeric;
  v_gid    text;
BEGIN
  IF p_cost_price IS NOT NULL AND p_cost_price >= 0 THEN
    IF p_price IS NULL OR p_price = 0 THEN
      RETURN NULL;
    END IF;
    IF (p_price - p_cost_price) <= 0 THEN
      RETURN NULL; -- profit<=0 -> không có nhóm
    END IF;
    v_margin := (p_price - p_cost_price) / p_price;

    -- findGroupForMargin: nhóm đầu (theo sort_order) thoả điều kiện
    SELECT id INTO v_gid
    FROM commission_groups
    WHERE v_margin >= COALESCE(min_margin, 0)
      AND (v_margin < COALESCE(max_margin, 1) OR COALESCE(max_margin, 1) >= 1)
    ORDER BY COALESCE(sort_order, 0)
    LIMIT 1;

    IF v_gid IS NULL THEN
      -- fallback: nhóm cuối cùng theo sort_order
      SELECT id INTO v_gid FROM commission_groups
      ORDER BY COALESCE(sort_order, 0) DESC LIMIT 1;
    END IF;
    RETURN v_gid;
  END IF;

  -- không có cost_price -> nhóm sort_order nhỏ nhất
  SELECT id INTO v_gid FROM commission_groups
  ORDER BY COALESCE(sort_order, 0) LIMIT 1;
  RETURN v_gid;
END;
$$;

-- ── Helper: rate theo số lượng (tier có min_qty lớn nhất <= qty) ─────────
-- Nếu nhóm không có tier -> dùng profit_share_rate của nhóm (fallback legacy).
CREATE OR REPLACE FUNCTION commission_rate_for_qty(
  p_group_id text,
  p_qty numeric
)
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rate   numeric;
  v_has    boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM commission_group_tiers WHERE group_id = p_group_id) INTO v_has;

  IF NOT v_has THEN
    -- getGroupTiers fallback: [{minQty:1, profitShareRate: group.profitShareRate ?? 0}]
    SELECT COALESCE(profit_share_rate, 0) INTO v_rate
    FROM commission_groups WHERE id = p_group_id;
    RETURN COALESCE(v_rate, 0);
  END IF;

  -- tiers sắp tăng theo min_qty: rate khởi tạo = tier đầu;
  -- với mỗi tier minQty<=qty -> cập nhật rate (tier cuối thoả thắng).
  SELECT t.profit_share_rate INTO v_rate
  FROM commission_group_tiers t
  WHERE t.group_id = p_group_id
    AND p_qty >= COALESCE(t.min_qty, 1)
  ORDER BY COALESCE(t.min_qty, 1) DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    -- qty < min_qty nhỏ nhất -> dùng tier đầu (rate khởi tạo)
    SELECT t.profit_share_rate INTO v_rate
    FROM commission_group_tiers t
    WHERE t.group_id = p_group_id
    ORDER BY COALESCE(t.min_qty, 1) ASC
    LIMIT 1;
  END IF;

  RETURN COALESCE(v_rate, 0);
END;
$$;

-- ── Tính HH cho 1 CTV (uid) -> jsonb summary ────────────────────────────
-- Output jsonb:
-- { collaboratorUid, collaboratorName, totalSales, totalCommission,
--   pendingCommission, paidCommission,
--   orders: [{ id, orderNumber, createdBy, total, shippingCost, status,
--              deliveryDate, commissionStatus, commissionAmount,
--              items:[{ id, productId, name, quantity, price, image,
--                       commissionAmount, commissionGroupName,
--                       commissionGroupQty, commissionRate }] }] }
CREATE OR REPLACE FUNCTION commission_summary(
  p_uid text,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- 1) Từng item của các đơn CTV này + nhóm/HH tính sẵn.
  WITH oi AS (
    SELECT
      o.id              AS order_id,
      o.order_number,
      o.created_by,
      o.total,
      o.shipping_cost,
      o.status,
      o.delivery_date,
      CASE WHEN o.commission_status = 'paid' THEN 'paid' ELSE 'pending' END AS commission_status,
      (o.status = 'CANCELLED' OR o.status = 'RETURNED') AS cancelled,
      -- month key của đơn (theo delivery_date text -> timestamp). NULL -> 'unknown'
      COALESCE(to_char((NULLIF(o.delivery_date,''))::timestamptz, 'YYYY-MM'), 'unknown') AS month_key,
      it.id             AS item_id,
      it.product_id,
      it.product_name,
      it.unit_price,
      it.quantity,
      it.image,
      it.ord            AS item_ord,
      p.price           AS prod_price,
      p.cost_price      AS prod_cost
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT x.id, x.product_id, x.product_name, x.unit_price, x.quantity, x.image,
             row_number() OVER (ORDER BY x.id) AS ord
      FROM order_items x WHERE x.order_id = o.id
    ) it ON TRUE
    LEFT JOIN products p ON p.id = it.product_id
    WHERE o.created_by = p_uid
  ),
  -- 2) gắn nhóm cho từng item (chỉ khi có product)
  oi_grp AS (
    SELECT oi.*,
           CASE WHEN oi.item_id IS NULL OR oi.product_id IS NULL THEN NULL
                ELSE commission_group_for_product(oi.prod_price, oi.prod_cost) END AS group_id
    FROM oi
  ),
  -- 3) tổng quantity mỗi (month, group) — bỏ đơn huỷ, bỏ item không có nhóm
  qty_by_group AS (
    SELECT month_key, group_id, SUM(COALESCE(quantity,1)) AS grp_qty
    FROM oi_grp
    WHERE NOT cancelled AND group_id IS NOT NULL
    GROUP BY month_key, group_id
  ),
  -- 4) rate theo qty mỗi (month, group)
  rate_by_group AS (
    SELECT month_key, group_id, grp_qty,
           commission_rate_for_qty(group_id, grp_qty) AS rate
    FROM qty_by_group
  ),
  -- 5) HH từng item
  item_calc AS (
    SELECT g.*,
           cg.name AS group_name,
           rbg.grp_qty,
           rbg.rate,
           CASE
             WHEN g.item_id IS NULL THEN 0
             WHEN g.cancelled THEN 0
             WHEN g.product_id IS NULL THEN 0           -- không có product -> ZERO
             WHEN g.group_id IS NULL THEN 0             -- không có nhóm -> ZERO
             ELSE
               -- itemCommissionAtRate(item.price ?? product.price, cost, fallback, rate) * qty
               (CASE
                  WHEN COALESCE(g.unit_price, g.prod_price) IS NULL
                       OR COALESCE(g.unit_price, g.prod_price) <= 0 THEN 0
                  WHEN g.prod_cost IS NOT NULL AND g.prod_cost >= 0 THEN
                    CASE WHEN (COALESCE(g.unit_price, g.prod_price) - g.prod_cost) <= 0 THEN 0
                         ELSE (COALESCE(g.unit_price, g.prod_price) - g.prod_cost) * COALESCE(rbg.rate,0) END
                  ELSE COALESCE(g.unit_price, g.prod_price) * COALESCE(cg.fallback_rate,0)
                END) * COALESCE(g.quantity, 1)
           END AS item_commission,
           -- groupName/Qty/rate chỉ gắn khi item hợp lệ & có nhóm & không huỷ
           CASE WHEN g.item_id IS NOT NULL AND NOT g.cancelled
                     AND g.product_id IS NOT NULL AND g.group_id IS NOT NULL
                THEN cg.name END AS out_group_name,
           CASE WHEN g.item_id IS NOT NULL AND NOT g.cancelled
                     AND g.product_id IS NOT NULL AND g.group_id IS NOT NULL
                THEN rbg.grp_qty END AS out_group_qty,
           CASE WHEN g.item_id IS NOT NULL AND NOT g.cancelled
                     AND g.product_id IS NOT NULL AND g.group_id IS NOT NULL
                THEN rbg.rate END AS out_rate
    FROM oi_grp g
    LEFT JOIN commission_groups cg ON cg.id = g.group_id
    LEFT JOIN rate_by_group rbg
      ON rbg.month_key = g.month_key AND rbg.group_id = g.group_id
  ),
  -- 6) gom item về đơn
  order_agg AS (
    SELECT
      order_id, order_number, created_by, total, shipping_cost, status,
      delivery_date, commission_status, cancelled,
      COALESCE(SUM(item_commission), 0) AS order_commission,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', item_id::text,
            'productId', product_id,
            'name', COALESCE(product_name,''),
            'quantity', COALESCE(quantity,1),
            'price', COALESCE(unit_price,0),
            'image', COALESCE(image,''),
            'commissionAmount', COALESCE(item_commission,0),
            'commissionGroupName', out_group_name,
            'commissionGroupQty', out_group_qty,
            'commissionRate', out_rate
          ) ORDER BY item_ord
        ) FILTER (WHERE item_id IS NOT NULL),
        '[]'::jsonb
      ) AS items
    FROM item_calc
    GROUP BY order_id, order_number, created_by, total, shipping_cost,
             status, delivery_date, commission_status, cancelled
  )
  SELECT jsonb_build_object(
    'collaboratorUid', p_uid,
    'collaboratorName', p_name,
    'totalSales', COALESCE(SUM(CASE WHEN NOT cancelled
        THEN GREATEST(COALESCE(total,0) - COALESCE(shipping_cost,0), 0) ELSE 0 END), 0),
    'totalCommission', COALESCE(SUM(CASE WHEN NOT cancelled THEN order_commission ELSE 0 END), 0),
    'pendingCommission', COALESCE(SUM(CASE WHEN NOT cancelled AND commission_status <> 'paid'
        THEN order_commission ELSE 0 END), 0),
    'paidCommission', COALESCE(SUM(CASE WHEN NOT cancelled AND commission_status = 'paid'
        THEN order_commission ELSE 0 END), 0),
    'orders', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', order_id,
          'orderNumber', order_number,
          'createdBy', created_by,
          'total', COALESCE(total,0),
          'shippingCost', COALESCE(shipping_cost,0),
          'status', status,
          'deliveryDate', delivery_date,
          'commissionStatus', commission_status,
          'commissionAmount', order_commission,
          'items', items
        )
        ORDER BY COALESCE((NULLIF(delivery_date,''))::timestamptz, 'epoch'::timestamptz) DESC
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM order_agg;

  RETURN COALESCE(v_result, jsonb_build_object(
    'collaboratorUid', p_uid,
    'collaboratorName', p_name,
    'totalSales', 0, 'totalCommission', 0,
    'pendingCommission', 0, 'paidCommission', 0,
    'orders', '[]'::jsonb
  ));
END;
$$;

-- ── Tính HH tất cả CTV (role='colaborator') -> jsonb array summaries ─────
-- Bỏ CTV không có đơn nào (giữ hành vi: orders.length===0 -> skip).
-- Sắp theo pendingCommission giảm dần.
CREATE OR REPLACE FUNCTION commission_summaries()
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_arr jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(s ORDER BY (s->>'pendingCommission')::numeric DESC), '[]'::jsonb)
  INTO v_arr
  FROM (
    SELECT commission_summary(
             u.uid,
             COALESCE(NULLIF(u.custom_name,''), NULLIF(u.display_name,''),
                      NULLIF(u.email,''), u.uid)
           ) AS s
    FROM users u
    WHERE lower(COALESCE(u.role,'')) = 'colaborator'
      AND EXISTS (SELECT 1 FROM orders o WHERE o.created_by = u.uid)
  ) t
  WHERE jsonb_array_length(s->'orders') > 0;

  RETURN COALESCE(v_arr, '[]'::jsonb);
END;
$$;

-- ── Đánh dấu đã trả / chưa trả hoa hồng cho danh sách đơn ────────────────
-- paid=true -> commission_status='paid', commission_paid_at=now ISO.
-- paid=false -> commission_status='pending', commission_paid_at=NULL.
CREATE OR REPLACE FUNCTION commission_set_paid(
  p_order_ids text[],
  p_paid boolean
)
RETURNS void
LANGUAGE sql AS $$
  UPDATE orders SET
    commission_status  = CASE WHEN p_paid THEN 'paid' ELSE 'pending' END,
    commission_paid_at = CASE WHEN p_paid
                              THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                              ELSE NULL END
  WHERE id = ANY(COALESCE(p_order_ids, ARRAY[]::text[]));
$$;
