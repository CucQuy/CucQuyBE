-- ============================================================
-- Phân tích kinh doanh: tổng hợp số liệu đơn hàng cho trang "Phân tích".
-- Read-only, STABLE. Loại đơn test; doanh thu chỉ tính đơn KHÔNG huỷ.
-- Trả 1 jsonb gồm: KPI, tỉ lệ hình thức giao, doanh thu/đơn theo tháng,
-- nhu cầu theo thứ trong tuần, cơ cấu trạng thái/thanh toán, top sản phẩm.
-- ============================================================
CREATE OR REPLACE FUNCTION analytics_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT * FROM orders WHERE COALESCE(is_test, false) = false
  ),
  valid AS (
    SELECT * FROM base WHERE COALESCE(status, '') <> 'CANCELLED'
  )
  SELECT jsonb_build_object(
    'kpi', (
      SELECT jsonb_build_object(
        'orders', count(*),
        'revenue', COALESCE(sum(total), 0),
        'aov', CASE WHEN count(*) > 0 THEN round(COALESCE(sum(total), 0) / count(*)) ELSE 0 END,
        'shipProvinceOrders', count(*) FILTER (WHERE delivery_type = 'SHIP_PROVINCE'),
        'shipOrders', count(*) FILTER (WHERE delivery_type = 'SHIP'),
        'pickupOrders', count(*) FILTER (WHERE delivery_type = 'PICKUP'),
        'deliveredOrders', count(*) FILTER (WHERE status = 'DELIVERED'),
        'paidRevenue', COALESCE(sum(paid_amount), 0)
      ) FROM valid
    ),
    'deliveryType', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.orders DESC), '[]'::jsonb) FROM (
        SELECT COALESCE(NULLIF(delivery_type, ''), 'UNKNOWN') AS type,
               count(*) AS orders, COALESCE(sum(total), 0) AS revenue
        FROM valid GROUP BY 1
      ) t
    ),
    'byMonth', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.month), '[]'::jsonb) FROM (
        SELECT to_char(order_date, 'YYYY-MM') AS month,
               count(*) AS orders, COALESCE(sum(total), 0) AS revenue
        FROM valid WHERE order_date IS NOT NULL GROUP BY 1
      ) t
    ),
    'byDow', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.dow), '[]'::jsonb) FROM (
        SELECT extract(dow FROM order_date)::int AS dow,
               count(*) AS orders, COALESCE(sum(total), 0) AS revenue
        FROM valid WHERE order_date IS NOT NULL GROUP BY 1
      ) t
    ),
    'statusBreakdown', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.orders DESC), '[]'::jsonb) FROM (
        SELECT COALESCE(NULLIF(status, ''), 'UNKNOWN') AS status, count(*) AS orders
        FROM base GROUP BY 1
      ) t
    ),
    'paymentBreakdown', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.orders DESC), '[]'::jsonb) FROM (
        SELECT COALESCE(NULLIF(payment_status, ''), 'UNKNOWN') AS status, count(*) AS orders
        FROM valid GROUP BY 1
      ) t
    ),
    'topProducts', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.qty DESC), '[]'::jsonb) FROM (
        SELECT oi.product_name AS name,
               sum(COALESCE(oi.quantity, 0)) AS qty,
               sum(COALESCE(oi.quantity, 0) * COALESCE(oi.unit_price, 0)) AS revenue
        FROM order_items oi JOIN valid v ON v.id = oi.order_id
        WHERE COALESCE(oi.product_name, '') <> ''
        GROUP BY 1 ORDER BY qty DESC LIMIT 15
      ) t
    ),
    -- Đơn TỈNH: so ngày SPX giao thực (delivered_at) với ngày CẦN giao (delivery_date).
    -- delta (ngày) = ngày giao − ngày cần giao. <0 sớm, =0 đúng, >0 trễ.
    'shipTimeliness', (
      WITH tl AS (
        SELECT order_number,
               to_date(left(delivery_date::text, 10), 'YYYY-MM-DD') AS need_date,
               (delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS delivered_date,
               ((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                 - to_date(left(delivery_date::text, 10), 'YYYY-MM-DD')) AS delta
        FROM orders
        WHERE delivery_type = 'SHIP_PROVINCE' AND COALESCE(is_test, false) = false
          AND delivered_at IS NOT NULL AND NULLIF(delivery_date::text, '') IS NOT NULL
      )
      SELECT jsonb_build_object(
        'count', (SELECT count(*) FROM tl),
        'avgDelta', (SELECT COALESCE(round(avg(delta)::numeric, 1), 0) FROM tl),
        'early', (SELECT count(*) FROM tl WHERE delta < 0),
        'onTime', (SELECT count(*) FROM tl WHERE delta = 0),
        'late', (SELECT count(*) FROM tl WHERE delta > 0),
        'maxLate', (SELECT COALESCE(max(delta), 0) FROM tl),
        'orders', (SELECT COALESCE(jsonb_agg(o ORDER BY o.delta DESC), '[]'::jsonb) FROM (
          SELECT order_number, need_date, delivered_date, delta FROM tl
        ) o)
      )
    ),
    'generatedAt', now()
  );
$$;
