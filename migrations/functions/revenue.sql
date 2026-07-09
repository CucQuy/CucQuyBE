-- ============================================================
-- Domain: revenue (báo cáo P&L) — CHỈ ĐỌC (aggregation).
-- Toàn bộ logic tổng hợp doanh thu/chi phí/hoa hồng nằm ở DB.
-- Port từ src/modules/revenue/revenue.service.ts (computeRevenueReport).
--
-- Ghi chú nguồn dữ liệu:
--   - Doanh thu : orders.total cho đơn KHÔNG huỷ/hoàn, theo delivery_date trong kỳ.
--   - Hoa hồng : tính per-item theo nhóm hoa hồng + bậc số lượng theo THÁNG
--                (port app logic computeByMonth), CHỈ đơn của CTV (role 'colaborator').
--   - Nhập kho : stock_receipts.total_amount theo receipt_date ?? created_at.
--   - Chi phí  : bảng `expenses` CHƯA tồn tại ở Postgres (vẫn ở Firestore) →
--                tổng chi phí khác = 0. Khi có bảng expenses, bổ sung CTE bên dưới.
--   - bankIn   : transactions transfer_type='in' theo transaction_date trong kỳ.
-- ============================================================

-- Cast text → timestamptz an toàn (trả NULL nếu không parse được).
CREATE OR REPLACE FUNCTION revenue_try_ts(p_text text)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_text::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- findGroupForMargin (port commission.types.ts): nhóm đầu tiên thoả
-- margin >= min_margin AND (margin < max_margin OR max_margin >= 1),
-- fallback = nhóm sort_order lớn nhất.
CREATE OR REPLACE FUNCTION revenue_find_group_for_margin(p_margin numeric)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT id FROM commission_groups
      WHERE p_margin >= coalesce(min_margin,0)
        AND (p_margin < max_margin OR max_margin >= 1)
      ORDER BY sort_order LIMIT 1),
    (SELECT id FROM commission_groups ORDER BY sort_order DESC LIMIT 1)
  );
$$;

-- rateForQuantity (port): rate của bậc cao nhất có min_qty <= qty;
-- nếu không có tier → dùng profit_share_rate của group (legacy), mặc định bậc minQty=1.
CREATE OR REPLACE FUNCTION revenue_rate_for_quantity(p_group_id text, p_qty numeric)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    -- có tiers: lấy bậc minQty lớn nhất <= qty; nếu qty < mọi minQty thì lấy bậc nhỏ nhất.
    (SELECT t.profit_share_rate
       FROM commission_group_tiers t
      WHERE t.group_id = p_group_id
      ORDER BY (t.min_qty <= p_qty) DESC, t.min_qty DESC
      LIMIT 1),
    -- không tiers: legacy profit_share_rate của group.
    (SELECT g.profit_share_rate FROM commission_groups g WHERE g.id = p_group_id),
    0
  );
$$;

-- itemCommissionAtRate (port):
--   price<=0 → 0
--   cost_price>=0 → profit<=0 ? 0 : profit*rate
--   else → price*fallback_rate
CREATE OR REPLACE FUNCTION revenue_item_commission(
  p_price numeric, p_cost_price numeric, p_fallback_rate numeric, p_rate numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(p_price,0) <= 0 THEN 0
    WHEN p_cost_price IS NOT NULL AND p_cost_price >= 0 THEN
      CASE WHEN (p_price - p_cost_price) <= 0 THEN 0
           ELSE (p_price - p_cost_price) * coalesce(p_rate,0) END
    ELSE p_price * coalesce(p_fallback_rate,0)
  END;
$$;

-- ------------------------------------------------------------
-- Hoa hồng per-order cho đơn của CTV (port computeByMonth/buildSummary).
-- Trả: (order_id, delivery_date text, status, commission_amount).
-- LƯU Ý: chỉ trả đơn của user role 'colaborator' (giống getAllSummaries).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION revenue_commission_orders()
RETURNS TABLE(order_id text, delivery_date text, status text, commission_amount numeric)
LANGUAGE sql STABLE AS $$
  WITH ctv AS (
    SELECT uid FROM users WHERE lower(coalesce(role,'')) = 'colaborator'
  ),
  ctv_orders AS (
    SELECT o.id, o.delivery_date, o.status,
           (o.status IN ('CANCELLED','RETURNED')) AS cancelled,
           to_char(date_trunc('month', revenue_try_ts(o.delivery_date)), 'YYYY-MM') AS month_key
    FROM orders o
    JOIN ctv ON ctv.uid = o.created_by
  ),
  groups AS (
    SELECT g.id, g.name, g.min_margin, g.max_margin, g.fallback_rate,
           g.profit_share_rate AS group_psr, g.sort_order
    FROM commission_groups g
  ),
  -- Chọn nhóm cho từng sản phẩm (port groupOfProduct):
  --  - có cost_price>=0 & profit>0 → findGroupForMargin(profit/price)
  --  - profit<=0                   → không nhóm (commission 0)
  --  - không có cost_price         → nhóm sort_order nhỏ nhất
  product_group AS (
    SELECT p.id AS product_id,
           p.price,
           p.cost_price,
           CASE
             WHEN p.cost_price IS NOT NULL AND p.cost_price >= 0 THEN
               CASE WHEN (p.price - p.cost_price) <= 0 THEN NULL
                    ELSE revenue_find_group_for_margin((p.price - p.cost_price) / NULLIF(p.price,0)) END
             ELSE (SELECT id FROM groups ORDER BY sort_order LIMIT 1)
           END AS group_id
    FROM products p
  ),
  -- Item của đơn CTV gắn nhóm hoa hồng.
  items AS (
    SELECT co.id AS order_id, co.month_key, co.cancelled,
           oi.product_id, oi.quantity, oi.unit_price,
           pg.group_id, pg.price AS prod_price, pg.cost_price
    FROM ctv_orders co
    JOIN order_items oi ON oi.order_id = co.id
    LEFT JOIN product_group pg ON pg.product_id = oi.product_id
  ),
  -- Tổng số lượng theo (tháng, nhóm) — CHỈ đơn không huỷ (port computeByMonth qtyByGroup).
  month_group_qty AS (
    SELECT month_key, group_id, SUM(coalesce(quantity,1)) AS qty
    FROM items
    WHERE NOT cancelled AND group_id IS NOT NULL
    GROUP BY month_key, group_id
  ),
  -- Rate theo bậc số lượng (port rateForQuantity) cho từng (tháng, nhóm).
  month_group_rate AS (
    SELECT mgq.month_key, mgq.group_id,
           revenue_rate_for_quantity(mgq.group_id, mgq.qty) AS rate
    FROM month_group_qty mgq
  ),
  -- Commission per-item (port itemCommissionAtRate * quantity). Đơn huỷ → 0.
  item_commission AS (
    SELECT i.order_id,
           CASE
             WHEN i.cancelled THEN 0
             WHEN i.group_id IS NULL THEN 0
             ELSE revenue_item_commission(
                    coalesce(i.unit_price, i.prod_price),
                    i.cost_price,
                    (SELECT fallback_rate FROM groups WHERE id = i.group_id),
                    coalesce((SELECT rate FROM month_group_rate r
                              WHERE r.month_key = i.month_key AND r.group_id = i.group_id), 0)
                  ) * coalesce(i.quantity, 1)
           END AS amount
    FROM items i
  )
  SELECT co.id, co.delivery_date, co.status,
         coalesce(SUM(ic.amount), 0) AS commission_amount
  FROM ctv_orders co
  LEFT JOIN item_commission ic ON ic.order_id = co.id
  GROUP BY co.id, co.delivery_date, co.status;
$$;

-- ------------------------------------------------------------
-- Báo cáo P&L trong kỳ (port getReport). RETURNS jsonb khớp RevenueReport.
-- p_from / p_to: ISO date/datetime (chuỗi). Rỗng → from = epoch, to = now.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION revenue_report(p_from text, p_to text)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_from        timestamptz;
  v_to          timestamptz;
  v_diff_days   int;
  v_bucket_days int;
  v_count       int;

  v_total_revenue   numeric := 0;
  v_order_count     int     := 0;
  v_total_commission numeric := 0;
  v_total_stock_in  numeric := 0;
  v_total_expenses  numeric := 0;  -- bảng expenses chưa có ở PG → 0
  v_total_costs     numeric := 0;
  v_profit          numeric := 0;
  v_margin          numeric := 0;
  v_bank_in         numeric := 0;
  v_bank_out        numeric := 0;  -- tiền ra: transactions transfer_type='out' trong kỳ (tổng)
  v_settled_out     numeric := 0;  -- tiền ra đã KẾT TOÁN (về TK chính) — trung tính, KHÔNG trừ doanh thu
  v_unclassified_out numeric := 0; -- tiền ra CHƯA phân loại (chưa hoàn, chưa kết toán) — cảnh báo
  v_total_refunded  numeric := 0;  -- tiền đã hoàn: order_refunds.amount theo created_at trong kỳ
  v_net_revenue     numeric := 0;  -- doanh thu thuần = doanh thu - tiền hoàn
  v_total_discount  numeric := 0;  -- tổng giảm giá (KM) các đơn trong kỳ
  v_series          jsonb;
BEGIN
  -- periodBounds: from @ 00:00:00, to @ 23:59:59.999
  v_from := coalesce(revenue_try_ts(p_from), to_timestamp(0));
  v_from := date_trunc('day', v_from);
  v_to := coalesce(revenue_try_ts(p_to), now());
  v_to := date_trunc('day', v_to) + interval '23:59:59.999';

  -- diffDays + bucketDays (port buildSeries)
  v_diff_days := round(EXTRACT(EPOCH FROM (v_to - v_from)) / 86400.0)::int + 1;
  v_bucket_days := CASE WHEN v_diff_days <= 31 THEN 1
                        WHEN v_diff_days <= 90 THEN 7
                        ELSE 30 END;
  v_count := greatest(1, ceil(v_diff_days::numeric / v_bucket_days)::int);

  -- ── Doanh thu: đơn không huỷ/hoàn, delivery_date trong kỳ ──
  SELECT coalesce(SUM(o.total),0), count(*), coalesce(SUM(o.discount_amount),0)
    INTO v_total_revenue, v_order_count, v_total_discount
  FROM orders o
  WHERE o.status IS DISTINCT FROM 'CANCELLED'
    AND o.status IS DISTINCT FROM 'RETURNED'
    AND revenue_try_ts(o.delivery_date) BETWEEN v_from AND v_to;

  -- ── Hoa hồng: đơn CTV không huỷ/hoàn, delivery_date trong kỳ ──
  SELECT coalesce(SUM(c.commission_amount),0)
    INTO v_total_commission
  FROM revenue_commission_orders() c
  WHERE c.status IS DISTINCT FROM 'CANCELLED'
    AND c.status IS DISTINCT FROM 'RETURNED'
    AND revenue_try_ts(c.delivery_date) BETWEEN v_from AND v_to;

  -- ── Nhập kho: receipt_date ?? created_at trong kỳ ──
  SELECT coalesce(SUM(r.total_amount),0)
    INTO v_total_stock_in
  FROM stock_receipts r
  WHERE coalesce(revenue_try_ts(r.receipt_date), r.created_at) BETWEEN v_from AND v_to;

  -- ── Chi phí khác: chưa có bảng → 0 ──
  v_total_expenses := 0;

  v_total_costs := v_total_commission + v_total_stock_in + v_total_expenses;
  v_profit := v_total_revenue - v_total_costs;
  v_margin := CASE WHEN v_total_revenue > 0 THEN v_profit / v_total_revenue ELSE 0 END;

  -- ── bankIn: transactions transfer_type='in' theo transaction_date ──
  SELECT coalesce(SUM(t.transfer_amount),0)
    INTO v_bank_in
  FROM transactions t
  WHERE t.transfer_type = 'in'
    AND revenue_try_ts(t.transaction_date) BETWEEN v_from AND v_to;

  -- ── bankOut: transactions transfer_type='out' theo transaction_date (đối xứng bankIn) ──
  -- Tách theo bản chất: đã kết toán (settled_out) vs chưa phân loại (chưa kết toán + chưa gắn phiếu hoàn).
  -- Tiền ra gắn phiếu hoàn không tính vào 2 nhóm này (đã phản ánh qua totalRefunded).
  SELECT
    coalesce(SUM(t.transfer_amount),0),
    coalesce(SUM(t.transfer_amount) FILTER (WHERE coalesce(t.settled_out,false)),0),
    coalesce(SUM(t.transfer_amount) FILTER (
      WHERE coalesce(t.settled_out,false) = false
        AND NOT EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = t.id)
    ),0)
    INTO v_bank_out, v_settled_out, v_unclassified_out
  FROM transactions t
  WHERE t.transfer_type = 'out'
    AND revenue_try_ts(t.transaction_date) BETWEEN v_from AND v_to;

  -- ── totalRefunded: tiền hoàn ghi nhận trong kỳ (order_refunds.amount theo created_at) ──
  SELECT coalesce(SUM(orf.amount),0)
    INTO v_total_refunded
  FROM order_refunds orf
  WHERE orf.created_at BETWEEN v_from AND v_to;

  -- ── netRevenue: doanh thu thuần = doanh thu (gross) − tiền hoàn ──
  -- LƯU Ý: tiền KẾT TOÁN (chuyển về TK chính) KHÔNG trừ — chỉ là chuyển nội bộ, không mất doanh thu.
  v_net_revenue := v_total_revenue - v_total_refunded;

  -- ── series (port buildSeries): revenue[] theo delivery_date, cost[] theo
  --    commission + stock_in + expenses; idx = floor((d - from)/bucketDays). ──
  WITH buckets AS (
    SELECT g AS i,
           v_from + (g * v_bucket_days || ' days')::interval AS bucket_start
    FROM generate_series(0, v_count - 1) AS g
  ),
  -- revenue: đơn không huỷ/hoàn có delivery_date hợp lệ (KHÔNG lọc theo kỳ ở
  -- bước này — buildSeries chỉ nạp revOrders đã lọc kỳ; ta dùng cùng filter kỳ).
  rev AS (
    SELECT floor(EXTRACT(EPOCH FROM (revenue_try_ts(o.delivery_date) - v_from))
                 / (v_bucket_days * 86400.0))::int AS idx,
           o.total AS amount
    FROM orders o
    WHERE o.status IS DISTINCT FROM 'CANCELLED'
      AND o.status IS DISTINCT FROM 'RETURNED'
      AND revenue_try_ts(o.delivery_date) BETWEEN v_from AND v_to
  ),
  rev_bucket AS (
    SELECT idx, coalesce(SUM(amount),0) AS revenue
    FROM rev WHERE idx >= 0 AND idx < v_count GROUP BY idx
  ),
  -- cost: commission (đơn CTV không huỷ, theo delivery_date) + stock_in
  -- (receipt_date ?? created_at) + expenses(0). addCost lọc d trong [from,to].
  cost_commission AS (
    SELECT floor(EXTRACT(EPOCH FROM (revenue_try_ts(c.delivery_date) - v_from))
                 / (v_bucket_days * 86400.0))::int AS idx,
           c.commission_amount AS amount
    FROM revenue_commission_orders() c
    WHERE c.status IS DISTINCT FROM 'CANCELLED'
      AND c.status IS DISTINCT FROM 'RETURNED'
      AND revenue_try_ts(c.delivery_date) BETWEEN v_from AND v_to
  ),
  cost_stock AS (
    SELECT floor(EXTRACT(EPOCH FROM (coalesce(revenue_try_ts(r.receipt_date), r.created_at) - v_from))
                 / (v_bucket_days * 86400.0))::int AS idx,
           r.total_amount AS amount
    FROM stock_receipts r
    WHERE coalesce(revenue_try_ts(r.receipt_date), r.created_at) BETWEEN v_from AND v_to
  ),
  cost_all AS (
    SELECT idx, amount FROM cost_commission
    UNION ALL SELECT idx, amount FROM cost_stock
  ),
  cost_bucket AS (
    SELECT idx, coalesce(SUM(amount),0) AS cost
    FROM cost_all WHERE idx >= 0 AND idx < v_count GROUP BY idx
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'label', EXTRACT(DAY FROM b.bucket_start)::int || '/' || EXTRACT(MONTH FROM b.bucket_start)::int,
             'revenue', coalesce(rb.revenue, 0),
             'profit', coalesce(rb.revenue, 0) - coalesce(cb.cost, 0)
           ) ORDER BY b.i
         )
    INTO v_series
  FROM buckets b
  LEFT JOIN rev_bucket rb ON rb.idx = b.i
  LEFT JOIN cost_bucket cb ON cb.idx = b.i;

  RETURN jsonb_build_object(
    'totalRevenue', v_total_revenue,
    'orderCount', v_order_count,
    'totalCommission', v_total_commission,
    'totalStockIn', v_total_stock_in,
    'totalExpenses', v_total_expenses,
    'totalCosts', v_total_costs,
    'profit', v_profit,
    'margin', v_margin,
    'bankIn', v_bank_in,
    'bankInDelta', v_bank_in - v_total_revenue,
    'bankOut', v_bank_out,
    'settledOut', v_settled_out,
    'unclassifiedOut', v_unclassified_out,
    'totalRefunded', v_total_refunded,
    'netRevenue', v_net_revenue,
    'totalDiscount', v_total_discount,
    'series', coalesce(v_series, '[]'::jsonb),
    'costBreakdown', jsonb_build_object(
      'stockIn', v_total_stock_in,
      'commission', v_total_commission,
      'expenses', v_total_expenses
    )
  );
END;
$$;
