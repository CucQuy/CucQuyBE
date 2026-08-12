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

-- Suy ra payment_status từ số tiền đã trả vs tổng đơn (dùng chung create/update/webhook).
--   REFUNDED (nếu chỉ định) > 0 tiền → UNPAID > 0<paid<total → DEPOSITED > paid≥total → PAID.
CREATE OR REPLACE FUNCTION order_derive_pay_status(p_paid numeric, p_total numeric, p_explicit text DEFAULT NULL)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_explicit = 'REFUNDED' THEN 'REFUNDED'
    WHEN COALESCE(p_paid, 0) <= 0 THEN 'UNPAID'
    WHEN COALESCE(p_paid, 0) < COALESCE(p_total, 0) THEN 'DEPOSITED'
    ELSE 'PAID'
  END;
$$;

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
      'image',     COALESCE(i.image, ''),
      'flavors',   COALESCE(to_jsonb(i.flavors), '[]'::jsonb),
      'size',      i.size,
      'sizeCounts', i.size_counts,
      'packagingOption', i.packaging_option
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

-- refunds của 1 đơn (bảng order_refunds) -> jsonb array camelCase, mới→cũ.
CREATE OR REPLACE FUNCTION order_refunds_json(p_order_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id',             r.id,
      'amount',         COALESCE(r.amount, 0),
      'reason',         COALESCE(r.reason, ''),
      'category',       COALESCE(r.category, ''),
      'items',          COALESCE(r.items, '[]'::jsonb),
      'createdAt',      r.created_at,
      'createdBy',      COALESCE(r.created_by, ''),
      -- đối soát (008/#186): gắn 1 giao dịch SePay 'out' hoặc đánh dấu tiền mặt
      'transactionId',  r.transaction_id,
      'reconciled',     COALESCE(r.reconciled, false),
      'reconcileMethod', r.reconcile_method,
      'reconciledAt',   r.reconciled_at,
      'reconciledBy',   r.reconciled_by
    ) ORDER BY r.created_at DESC, r.id DESC),
    '[]'::jsonb)
  FROM order_refunds r WHERE r.order_id = p_order_id;
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
    'surchargeAmount',   COALESCE(o.surcharge_amount, 0),
    'surchargeTag',      o.surcharge_tag,
    -- Phụ thu nhiều dòng; đơn cũ (chưa có surcharges) → dựng 1 dòng từ tag+amount legacy.
    'surcharges',        COALESCE(
                           NULLIF(o.surcharges, '[]'::jsonb),
                           CASE WHEN COALESCE(o.surcharge_amount, 0) > 0
                                THEN jsonb_build_array(jsonb_build_object('tag', o.surcharge_tag, 'amount', o.surcharge_amount))
                                ELSE '[]'::jsonb END),
    'subtotal',          COALESCE(o.subtotal, 0),
    'discountAmount',    COALESCE(o.discount_amount, 0),
    'appliedPromotions', order_applied_promotions_json(o.id),
    'giftItems',         order_gift_items_json(o.id),
    'total',             COALESCE(o.total, 0),
    'depositAmount',     COALESCE(o.deposit_amount, 0),
    'paidAmount',        COALESCE(o.paid_amount, 0),
    'remaining',         GREATEST(COALESCE(o.total, 0) - COALESCE(o.paid_amount, 0), 0),
    'shippingCost',      COALESCE(o.shipping_cost, 0),
    'status',            o.status,
    'paymentStatus',     o.payment_status,
    'paymentMethod',     o.payment_method,
    'deliveryType',      o.delivery_type,
    'orderDate',         o.order_date,
    'deliveryDate',      o.delivery_date,
    'deliveryTime',      o.delivery_time,
    'trackingNumber',    o.tracking_number,
    'trackingLink',      o.tracking_link,
    'trackingStatus',    o.tracking_status,
    'note',              COALESCE(o.note, ''),
    'createdByUid',      o.created_by,
    'createdBy',         order_creator_name(o.created_by),
    'updatedBy',         o.updated_by,
    'createdAt',         o.created_at,
    'updatedAt',         o.updated_at,
    'history',           order_history_json(o.id),
    'isTest',            COALESCE(o.is_test, false),
    'commissionStatus',  o.commission_status,
    'commissionPaidAt',  o.commission_paid_at,
    'refundedAmount',    COALESCE(o.refunded_amount, 0),
    'refundedAt',        o.refunded_at,
    'refundReason',      o.refund_reason,
    'refundedBy',        o.refunded_by,
    'cancelReason',      o.cancel_reason,
    'cancelledAt',       o.cancelled_at,
    'cancelledBy',       o.cancelled_by,
    'refunds',           order_refunds_json(o.id)
  )
  -- Giảm giá TAY {note, amount} + tổng. Tách jsonb_build_object riêng vì object chính đã
  -- chạm trần 100 args (50 cặp) của jsonb_build_object — gộp thêm cặp sẽ vỡ.
  || jsonb_build_object(
    'discounts',            COALESCE(o.discounts, '[]'::jsonb),
    'manualDiscountAmount', COALESCE(o.manual_discount_amount, 0),
    'billPrintedAt',        o.bill_printed_at,
    'coachInfo',            o.coach_info
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

-- Bản NHẸ cho DANH SÁCH: bỏ 5 subquery chỉ dùng ở màn CHI TIẾT
-- (history/refunds/decorations/appliedPromotions/giftItems → []). Màn chi tiết/sửa/share
-- fetch full qua order_get (GET /orders/:id). Giữ items+customer cho card/tìm kiếm.
CREATE OR REPLACE FUNCTION order_to_json_light(o orders)
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
    'decorations',       '[]'::jsonb,
    'surchargeAmount',   COALESCE(o.surcharge_amount, 0),
    'surchargeTag',      o.surcharge_tag,
    'surcharges',        COALESCE(
                           NULLIF(o.surcharges, '[]'::jsonb),
                           CASE WHEN COALESCE(o.surcharge_amount, 0) > 0
                                THEN jsonb_build_array(jsonb_build_object('tag', o.surcharge_tag, 'amount', o.surcharge_amount))
                                ELSE '[]'::jsonb END),
    'subtotal',          COALESCE(o.subtotal, 0),
    'discountAmount',    COALESCE(o.discount_amount, 0),
    'appliedPromotions', '[]'::jsonb,
    'giftItems',         '[]'::jsonb,
    'total',             COALESCE(o.total, 0),
    'depositAmount',     COALESCE(o.deposit_amount, 0),
    'paidAmount',        COALESCE(o.paid_amount, 0),
    'remaining',         GREATEST(COALESCE(o.total, 0) - COALESCE(o.paid_amount, 0), 0),
    'shippingCost',      COALESCE(o.shipping_cost, 0),
    'status',            o.status,
    'paymentStatus',     o.payment_status,
    'paymentMethod',     o.payment_method,
    'deliveryType',      o.delivery_type,
    'orderDate',         o.order_date,
    'deliveryDate',      o.delivery_date,
    'deliveryTime',      o.delivery_time,
    'trackingNumber',    o.tracking_number,
    'trackingLink',      o.tracking_link,
    'trackingStatus',    o.tracking_status,
    'note',              COALESCE(o.note, ''),
    'createdByUid',      o.created_by,
    'createdBy',         order_creator_name(o.created_by),
    'updatedBy',         o.updated_by,
    'createdAt',         o.created_at,
    'updatedAt',         o.updated_at,
    'history',           '[]'::jsonb,
    'isTest',            COALESCE(o.is_test, false),
    'commissionStatus',  o.commission_status,
    'commissionPaidAt',  o.commission_paid_at,
    'refundedAmount',    COALESCE(o.refunded_amount, 0),
    'refundedAt',        o.refunded_at,
    'refundReason',      o.refund_reason,
    'refundedBy',        o.refunded_by,
    'cancelReason',      o.cancel_reason,
    'cancelledAt',       o.cancelled_at,
    'cancelledBy',       o.cancelled_by,
    'refunds',           '[]'::jsonb
  )
  || jsonb_build_object(
    'discounts',            COALESCE(o.discounts, '[]'::jsonb),
    'manualDiscountAmount', COALESCE(o.manual_discount_amount, 0),
    'billPrintedAt',        o.bill_printed_at,
    'coachInfo',            o.coach_info
  );
$$;

-- Danh sách đơn (sắp orderNumber desc như FE) — dùng bản NHẸ (perf).
CREATE OR REPLACE FUNCTION order_list()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(order_to_json_light(o) ORDER BY o.order_number DESC NULLS LAST),
    '[]'::jsonb)
  FROM orders o;
$$;

-- Danh sách đơn PHÂN TRANG + LỌC + SẮP (server-side, cho trang Orders). Trả {items[], total}.
-- p (jsonb): search, status('All'|null=bỏ), paymentStatus, paymentMethod, creator, product,
--   dateType('orderDate'|'deliveryDate'), dateFrom/dateTo(yyyy-mm-dd), month(yyyy-mm),
--   hideCompleted, overdue(bool), sortField(date|deliveryDate|total|status|paymentStatus|orderNumber),
--   sortDir(asc|desc), limit, offset.
-- Sort 2 lớp: tier trạng thái (active→delivered→cancelled) + (nếu deliveryDate) badge priority theo
--   ngày VN (Asia/Ho_Chi_Minh) — khớp buildDeliveryBadge ở FE. Search lower() (không unaccent) khớp client.
CREATE OR REPLACE FUNCTION order_list_page(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_q text := NULLIF(lower(trim(p->>'search')),'');
  v_status text := NULLIF(p->>'status','');
  v_pay text := NULLIF(p->>'paymentStatus','');
  v_method text := NULLIF(p->>'paymentMethod','');
  v_creator text := NULLIF(lower(trim(p->>'creator')),'');
  v_product text := NULLIF(lower(trim(p->>'product')),'');
  v_date_type text := COALESCE(NULLIF(p->>'dateType',''),'deliveryDate');
  v_date_from text := NULLIF(p->>'dateFrom','');
  v_date_to text := NULLIF(p->>'dateTo','');
  v_month text := NULLIF(p->>'month','');
  v_hide boolean := COALESCE((p->>'hideCompleted')::boolean,false);
  v_overdue boolean := COALESCE((p->>'overdue')::boolean,false);
  v_sort text := COALESCE(NULLIF(p->>'sortField',''),'date');
  v_dir text := CASE WHEN lower(COALESCE(p->>'sortDir','desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_limit int := LEAST(GREATEST(COALESCE((p->>'limit')::int,10),1),100);
  v_offset int := GREATEST(COALESCE((p->>'offset')::int,0),0);
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_total int; v_items jsonb;
BEGIN
  WITH flt AS (
    SELECT o.id,
      CASE o.status WHEN 'DELIVERED' THEN 1 WHEN 'CANCELLED' THEN 2 WHEN 'RETURNED' THEN 2 ELSE 0 END AS tier,
      CASE WHEN o.status IN ('CANCELLED','RETURNED') THEN 5 WHEN o.status='DELIVERED' THEN 4
           WHEN NULLIF(o.delivery_date,'')::date IS NULL THEN 3
           WHEN NULLIF(o.delivery_date,'')::date <= v_today THEN 0 ELSE 1 END AS badge,
      NULLIF(o.delivery_date,'')::date AS ddate, o.order_date, o.total, o.order_number, o.status, o.payment_status
    FROM orders o
    WHERE (v_status IS NULL OR v_status='All' OR o.status=v_status)
      AND (NOT v_hide OR o.status NOT IN ('DELIVERED','CANCELLED','RETURNED'))
      AND (NOT v_overdue OR (o.status IN ('PENDING','PROCESSING') AND NULLIF(o.delivery_date,'')::date < v_today))
      AND (v_pay IS NULL OR o.payment_status=v_pay)
      AND (v_method IS NULL OR o.payment_method=v_method)
      AND (v_creator IS NULL OR lower(COALESCE(order_creator_name(o.created_by),'')) LIKE '%'||v_creator||'%')
      AND (v_q IS NULL OR lower(COALESCE(o.id,'')) LIKE '%'||v_q||'%' OR lower(COALESCE(o.order_number,'')) LIKE '%'||v_q||'%'
           OR lower(COALESCE(o.customer_name,'')) LIKE '%'||v_q||'%' OR lower(COALESCE(o.phone,'')) LIKE '%'||v_q||'%')
      AND (v_product IS NULL OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND lower(COALESCE(oi.product_name,'')) LIKE '%'||v_product||'%'))
      AND (v_month IS NULL OR to_char(CASE WHEN v_date_type='orderDate' THEN (o.order_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ELSE NULLIF(o.delivery_date,'')::date END,'YYYY-MM')=v_month)
      AND (v_date_from IS NULL OR (CASE WHEN v_date_type='orderDate' THEN (o.order_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ELSE NULLIF(o.delivery_date,'')::date END) >= v_date_from::date)
      AND (v_date_to IS NULL OR (CASE WHEN v_date_type='orderDate' THEN (o.order_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ELSE NULLIF(o.delivery_date,'')::date END) <= v_date_to::date)
  ),
  ranked AS (
    SELECT id, count(*) OVER()::int AS c,
      row_number() OVER (ORDER BY
        tier ASC,
        CASE WHEN v_sort='deliveryDate' THEN badge END ASC NULLS LAST,
        CASE WHEN v_sort='deliveryDate' AND v_dir='asc' THEN ddate END ASC NULLS LAST,
        CASE WHEN v_sort='deliveryDate' AND v_dir='desc' THEN ddate END DESC NULLS LAST,
        CASE WHEN v_sort='total' AND v_dir='asc' THEN total END ASC NULLS LAST,
        CASE WHEN v_sort='total' AND v_dir='desc' THEN total END DESC NULLS LAST,
        CASE WHEN v_sort='date' AND v_dir='asc' THEN order_date END ASC NULLS LAST,
        CASE WHEN v_sort='date' AND v_dir='desc' THEN order_date END DESC NULLS LAST,
        CASE WHEN v_sort='orderNumber' AND v_dir='asc' THEN order_number END ASC NULLS LAST,
        CASE WHEN v_sort='orderNumber' AND v_dir='desc' THEN order_number END DESC NULLS LAST,
        CASE WHEN v_sort='status' THEN status END ASC,
        CASE WHEN v_sort='paymentStatus' THEN payment_status END ASC,
        order_number DESC NULLS LAST) AS rn
    FROM flt
  )
  SELECT
    COALESCE((SELECT max(c) FROM ranked),0),
    COALESCE((SELECT jsonb_agg(order_to_json_light(o) ORDER BY r.rn)
              FROM ranked r JOIN orders o ON o.id=r.id
              WHERE r.rn > v_offset AND r.rn <= v_offset+v_limit),'[]'::jsonb)
  INTO v_total, v_items;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END; $$;

-- Đếm nhanh cho OrdersStats (không tải toàn bộ đơn): tổng/chờ xử lý/đã huỷ/chưa thanh toán.
CREATE OR REPLACE FUNCTION order_counts()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'total',     count(*)::int,
    'pending',   count(*) FILTER (WHERE status = 'PENDING')::int,
    'cancelled', count(*) FILTER (WHERE status IN ('CANCELLED','RETURNED'))::int,
    'unpaid',    count(*) FILTER (WHERE COALESCE(payment_status,'') NOT IN ('PAID','REFUNDED'))::int
  ) FROM orders;
$$;

-- 1 đơn theo id (jsonb đầy đủ) hoặc NULL.
CREATE OR REPLACE FUNCTION order_get(p_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT order_to_json(o) FROM orders o WHERE o.id = p_id;
$$;

-- ─────────────── Đối soát phiếu hoàn (008/#186) ───────────────
-- Helper: tên người thao tác từ p_user jsonb (giống order_update_status).
CREATE OR REPLACE FUNCTION refund_actor_name(p_user jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(p_user->>'displayName',''),
    NULLIF(p_user->>'email',''),
    CASE WHEN NULLIF(p_user->>'uid','') IS NOT NULL
         THEN 'User-' || left(p_user->>'uid', 6) END,
    'Unknown');
$$;

-- Gắn 1 phiếu hoàn ↔ 1 giao dịch SePay tiền RA (transfer_type='out'), đối soát.
-- Validate: phiếu tồn tại; giao dịch tồn tại + là 'out'; giao dịch chưa gắn phiếu
-- KHÁC. KHÔNG bắt khớp tuyệt đối transfer_amount = amount (có thể lệch do phí CK)
-- — nhưng RAISE WARNING khi lệch để dễ truy vết. Trả order_to_json(order_id).
CREATE OR REPLACE FUNCTION order_refund_reconcile(
  p_refund_id     text,
  p_transaction_id text,
  p_user          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_order_id text;
  v_amount   numeric;
  v_tx_type  text;
  v_tx_amount numeric;
  v_used_by  text;
  v_actor    text := refund_actor_name(p_user);
BEGIN
  -- phiếu hoàn tồn tại?
  SELECT order_id, amount INTO v_order_id, v_amount
  FROM order_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- giao dịch tồn tại + là tiền RA?
  SELECT transfer_type, transfer_amount INTO v_tx_type, v_tx_amount
  FROM transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSACTION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF COALESCE(v_tx_type,'') <> 'out' THEN
    RAISE EXCEPTION 'TRANSACTION_NOT_OUTGOING' USING ERRCODE = 'check_violation';
  END IF;

  -- giao dịch đã gắn cho phiếu KHÁC?
  SELECT id INTO v_used_by FROM order_refunds
  WHERE transaction_id = p_transaction_id AND id <> p_refund_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'TRANSACTION_ALREADY_LINKED' USING ERRCODE = 'unique_violation';
  END IF;

  IF v_tx_amount IS NOT NULL AND COALESCE(v_amount,0) <> v_tx_amount THEN
    RAISE WARNING 'Số tiền phiếu hoàn (%) lệch số tiền giao dịch (%) — vẫn cho đối soát',
      v_amount, v_tx_amount;
  END IF;

  UPDATE order_refunds SET
    transaction_id   = p_transaction_id,
    reconciled       = true,
    reconcile_method = 'sepay',
    reconciled_at    = now(),
    reconciled_by    = v_actor
  WHERE id = p_refund_id;

  RETURN order_get(v_order_id);
END;
$$;

-- Đánh dấu phiếu hoàn đã trả bằng TIỀN MẶT (không gắn giao dịch SePay).
CREATE OR REPLACE FUNCTION order_refund_mark_cash(
  p_refund_id text,
  p_user      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_order_id text;
  v_actor    text := refund_actor_name(p_user);
BEGIN
  SELECT order_id INTO v_order_id FROM order_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE order_refunds SET
    transaction_id   = NULL,
    reconciled       = true,
    reconcile_method = 'cash',
    reconciled_at    = now(),
    reconciled_by    = v_actor
  WHERE id = p_refund_id;

  RETURN order_get(v_order_id);
END;
$$;

-- Gỡ đối soát: trả phiếu về trạng thái CHƯA đối soát (gỡ giao dịch + method).
CREATE OR REPLACE FUNCTION order_refund_unreconcile(
  p_refund_id text,
  p_user      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_order_id text;
BEGIN
  SELECT order_id INTO v_order_id FROM order_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE order_refunds SET
    transaction_id   = NULL,
    reconciled       = false,
    reconcile_method = NULL,
    reconciled_at    = NULL,
    reconciled_by    = NULL
  WHERE id = p_refund_id;

  RETURN order_get(v_order_id);
END;
$$;

-- Tạo phiếu hoàn TAY cho 1 đơn theo HẠNG MỤC (đối soát tiền ra): thu hộ trùng,
-- hoàn phí ship (đổi qua tới lấy), huỷ đơn… KHÔNG gắn item. Cập nhật refunded_amount
-- (SELF-HEAL = tổng mọi phiếu) + ghi history. Nếu truyền p_transaction_id (GD tiền ra)
-- → GẮN + đối soát luôn (sepay) trong 1 lần. Trả order_to_json(order_id).
CREATE OR REPLACE FUNCTION order_refund_create(
  p_order_id       text,
  p_amount         numeric,
  p_category       text,
  p_reason         text,
  p_transaction_id text,
  p_user           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_actor     text := refund_actor_name(p_user);
  v_uid       text := NULLIF(p_user->>'uid','');
  v_refund_id text;
  v_tx_type   text;
  v_tx_amount numeric;
  v_used_by   text;
BEGIN
  -- Đơn tồn tại?
  PERFORM 1 FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  -- Số tiền hoàn hợp lệ?
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'ORDER_REFUND_AMOUNT_INVALID' USING ERRCODE = 'check_violation';
  END IF;

  -- Nếu gắn GD ngay: validate GD là tiền RA + chưa gắn phiếu khác.
  IF NULLIF(p_transaction_id, '') IS NOT NULL THEN
    SELECT transfer_type, transfer_amount INTO v_tx_type, v_tx_amount
    FROM transactions WHERE id = p_transaction_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSACTION_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF COALESCE(v_tx_type,'') <> 'out' THEN
      RAISE EXCEPTION 'TRANSACTION_NOT_OUTGOING' USING ERRCODE = 'check_violation';
    END IF;
    SELECT id INTO v_used_by FROM order_refunds
    WHERE transaction_id = p_transaction_id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'TRANSACTION_ALREADY_LINKED' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  INSERT INTO order_refunds (
    order_id, amount, reason, items, created_by, category,
    transaction_id, reconciled, reconcile_method, reconciled_at, reconciled_by)
  VALUES (
    p_order_id, p_amount, NULLIF(p_reason,''), '[]'::jsonb, v_actor, NULLIF(p_category,''),
    NULLIF(p_transaction_id,''),
    NULLIF(p_transaction_id,'') IS NOT NULL,
    CASE WHEN NULLIF(p_transaction_id,'') IS NOT NULL THEN 'sepay' END,
    CASE WHEN NULLIF(p_transaction_id,'') IS NOT NULL THEN now() END,
    CASE WHEN NULLIF(p_transaction_id,'') IS NOT NULL THEN v_actor END)
  RETURNING id INTO v_refund_id;

  -- refunded_amount = TỔNG mọi phiếu (không cộng dồn) → luôn khớp, không phình.
  UPDATE orders SET
    refunded_amount = COALESCE(
      (SELECT SUM(amount) FROM order_refunds WHERE order_id = p_order_id), 0),
    refunded_at   = now(),
    refund_reason = COALESCE(NULLIF(p_reason,''), refund_reason),
    refunded_by   = v_actor
  WHERE id = p_order_id;

  PERFORM order_add_history(p_order_id, v_actor, v_uid, jsonb_build_array(
    jsonb_build_object(
      'field', 'refunded_amount', 'label', 'Hoàn tiền',
      'oldValue', '—',
      'newValue', '+' || p_amount::text
        || COALESCE(' · ' || NULLIF(p_category,''), ''))));

  RETURN order_get(p_order_id);
END;
$$;

-- Danh sách TOÀN BỘ phiếu hoàn (mọi đơn) kèm ngữ cảnh đơn — phục vụ đối soát
-- TỪ PHÍA giao dịch tiền ra (tab "Tiền ra"): map 1 GD out ↔ 1 phiếu hoàn.
-- transactionId != NULL => phiếu đã gắn GD đó; reconciled/method cho biết trạng thái.
CREATE OR REPLACE FUNCTION refund_list_all()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'refundId',        r.id,
    'orderId',         r.order_id,
    'orderNumber',     o.order_number,
    'amount',          r.amount,
    'reason',          r.reason,
    'category',        r.category,
    'createdAt',       r.created_at,
    'transactionId',   r.transaction_id,
    'reconciled',      COALESCE(r.reconciled, false),
    'reconcileMethod', r.reconcile_method
  ) ORDER BY r.created_at DESC NULLS LAST), '[]'::jsonb)
  FROM order_refunds r
  LEFT JOIN orders o ON o.id = r.order_id;
$$;

-- ─────────────────── Ghi bảng con (nội bộ) ───────────────────
-- Xoá rồi chèn lại toàn bộ bảng con cho 1 đơn (đồng bộ từ payload jsonb).

-- items: payload mảng [{productId|id, name, quantity, price, image}].
CREATE OR REPLACE FUNCTION order_write_items(p_order_id text, p_items jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM order_items WHERE order_id = p_order_id;
  INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, image, flavors, size, size_counts, packaging_option)
  SELECT
    p_order_id,
    -- chỉ gán product_id nếu product còn tồn tại (tránh FK vỡ với product đã xoá/legacy); NULL nếu không
    (SELECT p.id FROM products p WHERE p.id = NULLIF(COALESCE(it->>'productId', it->>'id'), '')),
    NULLIF(it->>'name', ''),
    COALESCE(NULLIF(it->>'price','')::numeric, 0),
    COALESCE(NULLIF(it->>'quantity','')::numeric, 0),
    NULLIF(it->>'image', ''),
    CASE WHEN jsonb_typeof(it->'flavors') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(it->'flavors')) ELSE NULL END,
    NULLIF(it->>'size', ''),
    CASE WHEN jsonb_typeof(it->'sizeCounts') = 'array' THEN it->'sizeCounts' ELSE NULL END,
    NULLIF(it->>'packagingOption', '')
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
    (SELECT p.id FROM products p WHERE p.id = NULLIF(g->>'productId', '')),
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
  v_surcharge numeric := COALESCE(NULLIF(p_input->>'surchargeAmount','')::numeric, 0);
  v_surcharge_tag text := NULLIF(p_input->>'surchargeTag', '');
  v_surcharges jsonb := COALESCE(p_input->'surcharges', '[]'::jsonb);
  v_discounts jsonb := COALESCE(p_input->'discounts', '[]'::jsonb);
  v_manual_discount numeric := 0;
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

  -- Phụ thu nhiều dòng: có 'surcharges' → tổng = sum(amount), tag legacy = dòng đầu.
  -- Chỉ gửi surchargeAmount (cũ) & >0 → dựng 1 dòng. Không có → [].
  IF jsonb_array_length(v_surcharges) > 0 THEN
    v_surcharge := COALESCE((SELECT sum(NULLIF(e->>'amount','')::numeric)
                             FROM jsonb_array_elements(v_surcharges) e), 0);
    v_surcharge_tag := NULLIF(v_surcharges->0->>'tag', '');
  ELSIF v_surcharge > 0 THEN
    v_surcharges := jsonb_build_array(jsonb_build_object('tag', v_surcharge_tag, 'amount', v_surcharge));
  END IF;

  -- Map item.id -> productId cho engine (giống service cũ).
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(jsonb_build_object(
       'productId', COALESCE(it->>'productId', it->>'id'),
       'price',     COALESCE(NULLIF(it->>'price','')::numeric, 0),
       'quantity',  COALESCE(NULLIF(it->>'quantity','')::numeric, 0)
     )), '[]'::jsonb),
    'decorations', v_decos,
    'surchargeAmount', v_surcharge,
    'shippingCost', v_shipping,
    'code', p_input->>'appliedPromotionCode',
    'promotionIds', COALESCE(p_input->'appliedPromotionIds', '[]'::jsonb)
  ) INTO v_compute_in
  FROM jsonb_array_elements(v_items) AS it;

  -- Khi không có item, vòng FROM rỗng -> v_compute_in NULL: dựng input rỗng.
  IF v_compute_in IS NULL THEN
    v_compute_in := jsonb_build_object(
      'items', '[]'::jsonb, 'decorations', v_decos,
      'surchargeAmount', v_surcharge, 'shippingCost', v_shipping,
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

  -- Giảm giá TAY: tổng = sum(discounts.amount), trừ vào total SAU khuyến mãi (floor 0).
  v_manual_discount := COALESCE((SELECT sum(NULLIF(e->>'amount','')::numeric)
                                 FROM jsonb_array_elements(v_discounts) e), 0);
  v_total := GREATEST(0, v_total - v_manual_discount);

  -- customer_id chỉ set khi khớp customers.id (FK).
  v_cust_id := NULLIF(v_cust->>'id', '');
  IF v_cust_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id = v_cust_id) THEN
    v_cust_id := NULL;
  END IF;

  INSERT INTO orders (
    id, order_number, order_date, customer_id,
    customer_name, phone, address, email, customer_city, customer_country,
    subtotal, shipping_cost, discount_amount, total,
    deposit_amount, paid_amount,
    surcharge_amount, surcharge_tag, surcharges,
    discounts, manual_discount_amount,
    payment_status, payment_method, status, delivery_type, coach_info,
    delivery_date, delivery_time, note, tracking_number, sepay_id,
    commission_status, is_test, created_by, created_at
  ) VALUES (
    v_id, v_number, now(), v_cust_id,
    COALESCE(v_cust->>'name',''), COALESCE(v_cust->>'phone',''),
    COALESCE(v_cust->>'address',''), COALESCE(v_cust->>'email',''),
    NULLIF(v_cust->>'city',''), NULLIF(v_cust->>'country',''),
    v_subtotal, v_shipping, v_discount, v_total,
    COALESCE(NULLIF(p_input->>'depositAmount','')::numeric, 0),
    COALESCE(NULLIF(p_input->>'paidAmount','')::numeric,
             CASE WHEN NULLIF(p_input->>'paymentStatus','') = 'PAID' THEN v_total ELSE 0 END),
    v_surcharge, v_surcharge_tag, v_surcharges,
    v_discounts, v_manual_discount,
    order_derive_pay_status(
      COALESCE(NULLIF(p_input->>'paidAmount','')::numeric,
               CASE WHEN NULLIF(p_input->>'paymentStatus','') = 'PAID' THEN v_total ELSE 0 END),
      v_total, NULLIF(p_input->>'paymentStatus','')),
    COALESCE(NULLIF(p_input->>'paymentMethod',''), 'BANKING'),  -- mặc định đơn mới: chuyển khoản
    p_input->>'status',
    COALESCE(NULLIF(p_input->>'deliveryType',''), 'SHIP'),
    CASE WHEN p_input ? 'coachInfo' THEN p_input->'coachInfo' ELSE NULL END,
    NULLIF(p_input->>'deliveryDate',''),
    NULLIF(p_input->>'deliveryTime',''),
    COALESCE(p_input->>'note',''),
    NULLIF(p_input->>'trackingNumber',''),
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
  v_surcharge numeric := COALESCE(NULLIF(p_input->>'surchargeAmount','')::numeric, 0);
  v_surcharge_tag text := NULLIF(p_input->>'surchargeTag', '');
  v_surcharges jsonb := p_input->'surcharges';  -- NULL nếu client không gửi
  v_discounts jsonb := p_input->'discounts';    -- NULL nếu client không gửi
  v_manual_discount numeric := 0;
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
  -- ── Refund (issue #179) ──
  v_was_paid    boolean;          -- payment_status CŨ = 'PAID'
  v_old_total   numeric;          -- total trước cập nhật
  v_refund_delta numeric;         -- v_old_total − v_new_total
  v_has_decrease boolean := false; -- có ít nhất 1 dòng giảm SL
  v_has_increase boolean := false; -- có dòng tăng SL / item mới (chặn trên đơn PAID)
  v_refund_items jsonb;            -- danh sách dòng giảm {productName, qtyRefunded, unitPrice, amount}
  v_refund_amount numeric;        -- số tiền hoàn lần này (input.refund.amount hoặc delta)
  v_refund_in   jsonb := p_input->'refund';  -- {amount, reason} từ client (tuỳ chọn)
  v_refund_reason text;
  v_has_refund_in boolean;         -- payload CÓ gửi refund tường minh (modal đã xác nhận)
  v_sent_items  boolean := (p_input ? 'items'); -- payload CÓ gửi mảng items (để so sánh SL)
BEGIN
  SELECT * INTO v_existing FROM orders WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- snapshot trước cập nhật (để FE gửi Zalo update).
  v_prev := order_to_json(v_existing);

  -- Phụ thu nhiều dòng: nếu client gửi 'surcharges' → tổng = sum, tag legacy = dòng đầu
  -- (dùng cho recompute total bên dưới). Chỉ gửi surchargeAmount cũ & >0 → dựng 1 dòng.
  IF p_input ? 'surcharges' THEN
    v_surcharges := COALESCE(v_surcharges, '[]'::jsonb);
    v_surcharge  := COALESCE((SELECT sum(NULLIF(e->>'amount','')::numeric)
                              FROM jsonb_array_elements(v_surcharges) e), 0);
    v_surcharge_tag := NULLIF(v_surcharges->0->>'tag', '');
  ELSIF v_surcharge > 0 THEN
    v_surcharges := jsonb_build_array(jsonb_build_object('tag', v_surcharge_tag, 'amount', v_surcharge));
  END IF;

  -- CTV chỉ được sửa đơn của chính mình.
  IF v_role = 'colaborator' THEN
    IF v_uid IS NULL OR COALESCE(v_existing.created_by,'') = ''
       OR v_existing.created_by <> v_uid THEN
      RAISE EXCEPTION 'ORDER_EDIT_DENIED' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  v_has := jsonb_array_length(v_items) > 0;
  v_old_applied := order_applied_promotions_json(p_id);

  -- ── Phát hiện giảm/tăng SL theo product (issue #179) ──────────
  -- Khớp dòng cũ↔mới THUẦN THEO TÊN sản phẩm (lower). KHÔNG dùng product_id/id:
  -- data cũ có order_items.product_id RỖNG trong khi payload FE gửi items[].id (row-id)
  -- → khoá lệch → tưởng xoá+thêm mới → raise nhầm ORDER_PAID_NO_INCREASE (500). (hotfix #179)
  -- old: order_items hiện tại. new: items trong payload. qtyRefunded = oldQty − newQty (>0).
  v_was_paid  := COALESCE(v_existing.payment_status,'') = 'PAID';
  v_old_total := COALESCE(v_existing.total, 0);

  -- Chỉ so sánh SL khi payload CÓ gửi mảng items. Nếu KHÔNG gửi items
  -- (re-save chỉ đổi note/customer…) thì coi như không đổi SL → không giảm, không tăng,
  -- không hoàn. Tránh items='[]' bị hiểu nhầm là "giảm hết về 0".
  IF v_sent_items THEN
    WITH old_q AS (
      SELECT 'name:'||lower(COALESCE(oi.product_name,'')) AS k,
             COALESCE(oi.product_name,'') AS pname,
             COALESCE(oi.unit_price, 0)   AS price,
             SUM(COALESCE(oi.quantity, 0)) AS qty
      FROM order_items oi WHERE oi.order_id = p_id
      GROUP BY 1, 2, 3
    ),
    new_q AS (
      SELECT 'name:'||lower(COALESCE(it->>'name','')) AS k,
             SUM(COALESCE(NULLIF(it->>'quantity','')::numeric, 0)) AS qty
      FROM jsonb_array_elements(v_items) AS it
      GROUP BY 1
    ),
    -- FULL JOIN: bắt cả (a) name cũ giảm, (b) name cũ tăng, (c) name mới hoàn toàn.
    diff AS (
      SELECT COALESCE(o.pname, '') AS pname,
             COALESCE(o.price, 0)  AS price,
             COALESCE(o.qty, 0)    AS old_qty,
             COALESCE(n.qty, 0)    AS new_qty
      FROM old_q o FULL OUTER JOIN new_q n ON n.k = o.k
    )
    SELECT
      bool_or(d.new_qty < d.old_qty),
      bool_or(d.new_qty > d.old_qty),
      COALESCE(jsonb_agg(jsonb_build_object(
         'productName', d.pname,
         'qtyRefunded', d.old_qty - d.new_qty,
         'unitPrice',   d.price,
         'amount',      (d.old_qty - d.new_qty) * d.price
       ) ORDER BY d.pname) FILTER (WHERE d.new_qty < d.old_qty), '[]'::jsonb)
    INTO v_has_decrease, v_has_increase, v_refund_items
    FROM diff d;
  END IF;

  v_has_decrease := COALESCE(v_has_decrease, false);
  v_has_increase := COALESCE(v_has_increase, false);

  -- Đơn ĐÃ THANH TOÁN chỉ được GIẢM số lượng, không được tăng / thêm item.
  -- Mọi path tăng (qty payload > qty DB cho bất kỳ name, hoặc item mới) đều raise.
  IF v_was_paid AND v_has_increase THEN
    -- Message = chữ ký lỗi (BE map sang 4xx). Đơn đã thanh toán chỉ được giảm số lượng.
    RAISE EXCEPTION 'ORDER_PAID_NO_INCREASE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(jsonb_build_object(
       'productId', COALESCE(it->>'productId', it->>'id'),
       'price',     COALESCE(NULLIF(it->>'price','')::numeric, 0),
       'quantity',  COALESCE(NULLIF(it->>'quantity','')::numeric, 0)
     )), '[]'::jsonb),
    'decorations', v_decos,
    'surchargeAmount', v_surcharge,
    'shippingCost', v_shipping,
    'code', p_input->>'appliedPromotionCode',
    'promotionIds', COALESCE(p_input->'appliedPromotionIds', '[]'::jsonb)
  ) INTO v_compute_in
  FROM jsonb_array_elements(v_items) AS it;

  IF v_compute_in IS NULL THEN
    v_compute_in := jsonb_build_object(
      'items', '[]'::jsonb, 'decorations', v_decos,
      'surchargeAmount', v_surcharge, 'shippingCost', v_shipping,
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

  -- Giảm giá TAY: nếu client gửi 'discounts' → tổng mới; else giữ tổng cũ. Trừ vào total (floor 0).
  IF p_input ? 'discounts' THEN
    v_manual_discount := COALESCE((SELECT sum(NULLIF(e->>'amount','')::numeric)
                                   FROM jsonb_array_elements(COALESCE(v_discounts, '[]'::jsonb)) e), 0);
  ELSE
    v_manual_discount := COALESCE(v_existing.manual_discount_amount, 0);
  END IF;
  v_total := GREATEST(0, v_total - v_manual_discount);

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
    -- 'surcharges' là nguồn chuẩn cho phụ thu nhiều dòng; khi có → cập nhật cả tổng + tag.
    surcharge_amount = CASE WHEN (p_input ? 'surcharges' OR p_input ? 'surchargeAmount')
                            THEN v_surcharge ELSE surcharge_amount END,
    surcharge_tag    = CASE WHEN (p_input ? 'surcharges' OR p_input ? 'surchargeTag')
                            THEN v_surcharge_tag ELSE surcharge_tag END,
    surcharges       = CASE WHEN p_input ? 'surcharges'
                            THEN v_surcharges ELSE surcharges END,
    -- Giảm giá tay: chỉ cập nhật khi client gửi 'discounts'.
    discounts        = CASE WHEN p_input ? 'discounts'
                            THEN COALESCE(v_discounts, '[]'::jsonb) ELSE discounts END,
    manual_discount_amount = CASE WHEN p_input ? 'discounts'
                            THEN v_manual_discount ELSE manual_discount_amount END,
    note             = COALESCE(p_input->>'note',''),
    status           = p_input->>'status',
    delivery_date    = CASE WHEN p_input ? 'deliveryDate'
                            THEN NULLIF(p_input->>'deliveryDate','') ELSE delivery_date END,
    delivery_time    = CASE WHEN p_input ? 'deliveryTime'
                            THEN NULLIF(p_input->>'deliveryTime','') ELSE delivery_time END,
    tracking_number  = CASE WHEN p_input ? 'trackingNumber'
                            THEN NULLIF(p_input->>'trackingNumber','') ELSE tracking_number END,
    -- Cọc: chỉ đổi khi input gửi; nếu không, giữ nguyên (webhook cập nhật paid_amount riêng).
    deposit_amount   = CASE WHEN p_input ? 'depositAmount'
                            THEN COALESCE(NULLIF(p_input->>'depositAmount','')::numeric, 0) ELSE deposit_amount END,
    paid_amount      = CASE WHEN p_input ? 'paidAmount'
                            THEN COALESCE(NULLIF(p_input->>'paidAmount','')::numeric, 0) ELSE paid_amount END,
    -- payment_status: ưu tiên explicit (kể cả REFUNDED giữ như cũ), else suy ra từ paid_amount vs total.
    payment_status   = COALESCE(
                         NULLIF(p_input->>'paymentStatus',''),
                         order_derive_pay_status(
                           CASE WHEN p_input ? 'paidAmount'
                                THEN COALESCE(NULLIF(p_input->>'paidAmount','')::numeric, 0)
                                ELSE COALESCE(paid_amount, 0) END,
                           v_total, NULL)),
    payment_method   = COALESCE(NULLIF(p_input->>'paymentMethod',''), 'CASH'),
    -- Vá nợ kỹ thuật: persist field huỷ đơn từ input nếu có (giữ giá trị cũ nếu không gửi).
    cancel_reason    = CASE WHEN p_input ? 'cancelReason'
                            THEN NULLIF(p_input->>'cancelReason','') ELSE cancel_reason END,
    cancelled_at     = CASE WHEN p_input ? 'cancelledAt' AND NULLIF(p_input->>'cancelledAt','') IS NOT NULL
                            THEN now() ELSE cancelled_at END,
    cancelled_by     = CASE WHEN p_input ? 'cancelledBy'
                            THEN NULLIF(p_input->>'cancelledBy','') ELSE cancelled_by END,
    sepay_id         = CASE WHEN p_input ? 'sepayId'
                            THEN NULLIF(p_input->>'sepayId','') ELSE sepay_id END,
    is_test          = CASE WHEN p_input ? 'isTest'
                            THEN COALESCE((p_input->>'isTest')::boolean, false) ELSE is_test END,
    delivery_type    = CASE WHEN p_input ? 'deliveryType'
                            THEN p_input->>'deliveryType' ELSE delivery_type END,
    coach_info       = CASE WHEN p_input ? 'coachInfo'
                            THEN p_input->'coachInfo' ELSE coach_info END,
    updated_at       = now(),
    updated_by       = CASE WHEN p_changes IS NOT NULL AND jsonb_array_length(p_changes) > 0
                            THEN v_editor ELSE updated_by END
  WHERE id = p_id;

  -- CHỈ ghi lại items khi payload CÓ gửi mảng `items`. Nếu KHÔNG gửi (PATCH partial:
  -- đổi status / paymentStatus / note…) thì GIỮ NGUYÊN order_items cũ — tránh
  -- order_write_items DELETE sạch rồi INSERT [] → xoá mất sản phẩm của đơn.
  IF v_sent_items THEN
    PERFORM order_write_items(p_id, v_items);
  END IF;
  PERFORM order_write_decorations(p_id, v_decos);
  PERFORM order_write_applied(p_id, v_applied);

  -- Ghi history nếu có thay đổi.
  IF p_changes IS NOT NULL AND jsonb_array_length(p_changes) > 0 THEN
    PERFORM order_add_history(p_id, v_editor, v_uid, p_changes);
  END IF;

  -- ── Hoàn tiền khi giảm SL trên đơn ĐÃ THANH TOÁN (issue #179, dedup #185) ──
  -- IDEMPOTENT: CHỈ ghi phiếu hoàn khi payload CÓ `refund` tường minh (modal FE đã xác nhận).
  -- BỎ nhánh fallback theo delta → re-save / sửa field khác (không gửi refund) KHÔNG tạo phiếu.
  -- Vẫn validate: chỉ chấp nhận khi đơn (CŨ) PAID + thực sự có dòng giảm SL + 0 < amount ≤ total_cũ.
  v_has_refund_in := (p_input ? 'refund')
                     AND NULLIF(v_refund_in->>'amount','') IS NOT NULL
                     AND (v_refund_in->>'amount')::numeric > 0;
  v_refund_delta := v_old_total - COALESCE(v_total, 0);

  IF v_has_refund_in THEN
    -- Gửi refund nhưng đơn không đủ điều kiện hoàn (không PAID hoặc không giảm SL) → bỏ qua, KHÔNG ghi sai.
    IF v_was_paid AND v_has_decrease THEN
      v_refund_amount := (v_refund_in->>'amount')::numeric;
      -- Validate: 0 < amount ≤ total_cũ.
      IF v_refund_amount <= 0 OR v_refund_amount > v_old_total THEN
        -- Message = chữ ký lỗi (BE map sang 4xx).
        RAISE EXCEPTION 'ORDER_REFUND_AMOUNT_INVALID' USING ERRCODE = 'check_violation';
      END IF;
      v_refund_reason := NULLIF(v_refund_in->>'reason','');

      INSERT INTO order_refunds (order_id, amount, reason, items, created_by, category)
      VALUES (p_id, v_refund_amount, v_refund_reason, v_refund_items, v_editor, 'reduce_qty');

      -- SELF-HEAL: refunded_amount = TỔNG mọi phiếu (không cộng dồn) → luôn khớp, không phình.
      UPDATE orders SET
        refunded_amount = COALESCE(
          (SELECT SUM(amount) FROM order_refunds WHERE order_id = p_id), 0),
        refunded_at     = now(),
        refund_reason   = COALESCE(v_refund_reason, refund_reason),
        refunded_by     = v_editor
      WHERE id = p_id;

      -- Ghi 1 history entry loại refund (field refunded_amount).
      PERFORM order_add_history(p_id, v_editor, v_uid, jsonb_build_array(
        jsonb_build_object(
          'field', 'refunded_amount', 'label', 'Hoàn tiền',
          'oldValue', '—',
          'newValue', '+' || v_refund_amount::text)));
    END IF;
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

-- ─────────────────── Đánh dấu đã in bill cho khách ───────────────────
-- Set bill_printed_at = now() (mốc in bill gần nhất). Nhẹ: không ghi history / không tính lại.
-- Idempotent: in lại chỉ cập nhật mốc. Trả order đầy đủ (đã có billPrintedAt).
CREATE OR REPLACE FUNCTION order_mark_bill_printed(
  p_id   text,
  p_user jsonb
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_uid       text := NULLIF(p_user->>'uid','');
  v_editor    text;
  v_uid_short text;
BEGIN
  PERFORM 1 FROM orders WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  v_uid_short := CASE WHEN v_uid IS NOT NULL THEN 'User-' || left(v_uid, 6) END;
  v_editor := COALESCE(NULLIF(p_user->>'displayName',''), NULLIF(p_user->>'email',''),
                       v_uid_short, 'Unknown');

  UPDATE orders SET
    bill_printed_at = now(),
    updated_at      = now(),
    updated_by      = v_editor
  WHERE id = p_id;

  RETURN order_get(p_id);
END;
$$;

-- ─────────────────────── Patch field NHẸ (perf) ───────────────────────
-- Cập nhật NHANH các field đơn giản (paymentStatus/paymentMethod/deliveryType) —
-- CHỈ đụng đúng field gửi lên (whitelist), KHÔNG tính lại KM / ghi lại items như
-- order_update full. Ghi 1 history gộp. Trả order_get(id). Dùng cho các nút nhanh.
CREATE OR REPLACE FUNCTION order_patch_fields(p_id text, p_patch jsonb, p_user jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_ex       orders%ROWTYPE;
  v_uid      text := NULLIF(p_user->>'uid','');
  v_editor   text;
  v_uid_short text;
  v_changes  jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_ex FROM orders WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- CTV chỉ sửa đơn của mình (giữ chữ ký lỗi như order_update).
  IF lower(COALESCE(p_user->>'role','')) = 'colaborator' THEN
    IF v_uid IS NULL OR COALESCE(v_ex.created_by,'') = '' OR v_ex.created_by <> v_uid THEN
      RAISE EXCEPTION 'ORDER_EDIT_DENIED' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  v_uid_short := CASE WHEN v_uid IS NOT NULL THEN 'User-' || left(v_uid, 6) END;
  v_editor := COALESCE(NULLIF(p_user->>'displayName',''), NULLIF(p_user->>'email',''),
                       v_uid_short, 'Unknown');

  IF p_patch ? 'paymentStatus'
     AND COALESCE(v_ex.payment_status,'') <> COALESCE(p_patch->>'paymentStatus','') THEN
    UPDATE orders SET payment_status = p_patch->>'paymentStatus' WHERE id = p_id;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field','paymentStatus','label','Thanh toán',
      'oldValue',COALESCE(NULLIF(v_ex.payment_status,''),'—'),
      'newValue',COALESCE(NULLIF(p_patch->>'paymentStatus',''),'—')));
  END IF;

  IF p_patch ? 'paymentMethod'
     AND COALESCE(v_ex.payment_method,'') <> COALESCE(p_patch->>'paymentMethod','') THEN
    UPDATE orders SET payment_method = p_patch->>'paymentMethod' WHERE id = p_id;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field','paymentMethod','label','Phương thức TT',
      'oldValue',COALESCE(NULLIF(v_ex.payment_method,''),'—'),
      'newValue',COALESCE(NULLIF(p_patch->>'paymentMethod',''),'—')));
  END IF;

  IF p_patch ? 'deliveryType'
     AND COALESCE(v_ex.delivery_type,'') <> COALESCE(p_patch->>'deliveryType','') THEN
    UPDATE orders SET delivery_type = p_patch->>'deliveryType' WHERE id = p_id;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field','deliveryType','label','Kiểu giao',
      'oldValue',COALESCE(NULLIF(v_ex.delivery_type,''),'—'),
      'newValue',COALESCE(NULLIF(p_patch->>'deliveryType',''),'—')));
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    UPDATE orders SET updated_at = now(), updated_by = v_editor WHERE id = p_id;
    PERFORM order_add_history(p_id, v_editor, v_uid, v_changes);
  END IF;

  RETURN jsonb_build_object(
    'order', order_get(p_id),
    'changes', v_changes,
    'prevOrder', order_to_json(v_ex));
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

-- ─────────────────────────────────────────────────────────────────────────
-- Đối soát TAY 1 giao dịch (tiền vào/ra) với 1 đơn ngay từ form đơn.
-- Tiền VÀO (in) → +amount (thu cọc/thanh toán); tiền RA (out) → −amount (hoàn/đối ứng).
-- Cập nhật paid_amount rồi suy lại payment_status (UNPAID/DEPOSITED/PAID) + gắn
-- order_number cho giao dịch. CHỈ đụng paid_amount/payment_status → KHÔNG ghi đè
-- items như order_update (an toàn khi form còn sửa dở). Idempotent: GD đã gắn đúng
-- đơn này rồi thì không cộng lại. Trả order_to_json để FE refresh.
CREATE OR REPLACE FUNCTION order_reconcile_transaction(
  p_order_id       text,
  p_transaction_id text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  o          orders;
  v_amount   numeric;
  v_type     text;
  v_tx_order text;
  v_sepay    bigint;
  v_new_paid numeric;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  SELECT COALESCE(transfer_amount, 0), COALESCE(transfer_type, 'in'), order_number, sepay_id
    INTO v_amount, v_type, v_tx_order, v_sepay
    FROM transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSACTION_NOT_FOUND'; END IF;

  -- Đã gắn đúng đơn này rồi → không cộng lại (idempotent), trả nguyên trạng.
  IF v_tx_order IS NULL OR v_tx_order <> o.order_number THEN
    v_new_paid := GREATEST(0, COALESCE(o.paid_amount, 0)
                    + (CASE WHEN v_type = 'out' THEN -1 ELSE 1 END) * v_amount);
    UPDATE orders
       SET paid_amount    = v_new_paid,
           payment_status = order_derive_pay_status(v_new_paid, total, payment_status),
           sepay_id       = COALESCE(sepay_id, v_sepay::text),
           updated_at     = now()
     WHERE id = p_order_id
     RETURNING * INTO o;

    UPDATE transactions
       SET order_number = o.order_number, needs_review = false, review_note = NULL
     WHERE id = p_transaction_id;
  END IF;

  RETURN order_to_json(o);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Đồng bộ vận đơn từ file 3PL (SPX/GHTK…). p_rows = [{tracking, link, status, name, phone}].
-- Match đơn theo 9 SỐ CUỐI của SĐT người nhận (bỏ số 0 đầu), ưu tiên đơn CHƯA có vận đơn +
-- mới nhất, loại đơn CANCELLED. p_apply=false → chỉ preview; true → ghi tracking_number/link/status.
-- Trả {matched:[...], unmatched:[...], applied, matchedCount, unmatchedCount}.
-- Đồng bộ VẬN ĐƠN từ file SPX. Xử lý mã bị HUỶ + tạo lại:
--   • Khớp đơn theo "Mã khách hàng" (orderRef = order_number) TRƯỚC, rồi mới theo SĐT.
--   • Gộp mọi dòng cùng 1 đơn: chọn mã ACTIVE (không huỷ) MỚI NHẤT theo createTime.
--   • Mã cũ của đơn đã HUỶ mà file có mã mới active → THAY mã mới (dù đơn đã có mã).
--   • Đơn đang giữ đúng 1 mã đã huỷ, chưa có mã mới → đánh dấu tracking_status='Đã hủy' (bucket cancelled).
--   • Đơn đã có mã ACTIVE khác (không nằm trong danh sách huỷ) → SKIP, không ghi đè (an toàn).
-- Buckets trả: matched[] (assign/replace), skipped[], cancelled[], unmatched[].
CREATE OR REPLACE FUNCTION order_sync_tracking(p_rows jsonb, p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_result jsonb;
  h        record;
BEGIN
  -- (1) Chuẩn hoá + khớp đơn (ORD trước, SĐT sau) — pre-state, dùng cho cả report & apply.
  DROP TABLE IF EXISTS _sync_res;
  CREATE TEMP TABLE _sync_res ON COMMIT DROP AS
  WITH rws AS (
    SELECT
      NULLIF(trim(e->>'tracking'),'') AS tracking,
      NULLIF(trim(e->>'link'),'')     AS link,
      NULLIF(trim(e->>'status'),'')   AS status,
      NULLIF(trim(e->>'name'),'')     AS name,
      right(regexp_replace(coalesce(e->>'phone',''),'\D','','g'),9) AS phone9,
      CASE WHEN upper(trim(coalesce(e->>'orderRef',''))) ~ '^ORD' THEN upper(trim(e->>'orderRef')) END AS order_ref,
      NULLIF(trim(e->>'createTime'),'') AS create_time,
      -- huỷ: khớp "huy" như 1 TỪ (ranh giới) để tránh nuốt "chuyển"→"chuyen" (chứa 'huy').
      (unaccent(lower(coalesce(e->>'status',''))) ~ '(\mhuy\M|cancel)') AS is_cancel
    FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) e
    WHERE NULLIF(trim(e->>'tracking'),'') IS NOT NULL
  )
  SELECT rws.*, o.id AS oid, o.order_number AS onum, o.customer_name AS ocust, o.tracking_number AS had
  FROM rws
  LEFT JOIN LATERAL (
    SELECT o2.id, o2.order_number, o2.customer_name, o2.tracking_number
    FROM orders o2
    WHERE coalesce(o2.status,'')<>'CANCELLED' AND (
      (rws.order_ref IS NOT NULL AND upper(o2.order_number)=rws.order_ref)
      OR (rws.order_ref IS NULL AND length(rws.phone9)>=8
          AND right(regexp_replace(coalesce(o2.phone,''),'\D','','g'),9)=rws.phone9))
    ORDER BY (o2.order_number IS NOT NULL) DESC, o2.created_at DESC NULLS LAST
    LIMIT 1
  ) o ON true;

  -- (2) Gộp theo đơn + quyết định hành động (từ pre-state 'had').
  DROP TABLE IF EXISTS _sync_dec;
  CREATE TEMP TABLE _sync_dec ON COMMIT DROP AS
  WITH per_order AS (
    SELECT oid, max(onum) AS onum, max(ocust) AS ocust, max(had) AS had,
      (array_remove(array_agg(tracking ORDER BY create_time DESC NULLS LAST) FILTER (WHERE NOT is_cancel), NULL))[1] AS best_tk,
      (array_remove(array_agg(link     ORDER BY create_time DESC NULLS LAST) FILTER (WHERE NOT is_cancel), NULL))[1] AS best_link,
      (array_remove(array_agg(status   ORDER BY create_time DESC NULLS LAST) FILTER (WHERE NOT is_cancel), NULL))[1] AS best_status,
      (array_agg(name ORDER BY create_time DESC NULLS LAST))[1] AS name,
      array_remove(array_agg(tracking) FILTER (WHERE is_cancel), NULL) AS cancelled_tks
    FROM _sync_res WHERE oid IS NOT NULL GROUP BY oid
  )
  SELECT *, CASE
    WHEN best_tk IS NULL THEN
      CASE WHEN had IS NOT NULL AND had = ANY(coalesce(cancelled_tks,'{}')) THEN 'cancelled' ELSE 'noop' END
    WHEN had IS NULL THEN 'assign'
    WHEN had = best_tk THEN 'skip_same'
    WHEN had = ANY(coalesce(cancelled_tks,'{}')) THEN 'replace'
    ELSE 'skip_existing' END AS action
  FROM per_order;

  -- (3) Ghi (chỉ khi apply): assign/replace mã mới; đơn giữ mã huỷ → đánh dấu 'Đã hủy'.
  IF p_apply THEN
    -- (3a) Ghi LỊCH SỬ đổi mã (dùng trạng thái CŨ, trước khi UPDATE).
    FOR h IN
      SELECT dc.oid, dc.action, dc.had, dc.best_tk, o.tracking_status AS cur_status
      FROM _sync_dec dc JOIN orders o ON o.id = dc.oid
      WHERE dc.action IN ('assign','replace','cancelled')
        AND NOT (dc.action = 'cancelled' AND coalesce(o.tracking_status,'') = 'Đã hủy')
    LOOP
      PERFORM order_add_history(h.oid, 'Đồng bộ SPX', NULL,
        CASE h.action
          WHEN 'assign'  THEN jsonb_build_array(jsonb_build_object(
            'field','tracking_number','label','Gán mã vận đơn','oldValue','—','newValue', h.best_tk))
          WHEN 'replace' THEN jsonb_build_array(jsonb_build_object(
            'field','tracking_number','label','Thay mã vận đơn (mã cũ đã huỷ)','oldValue', coalesce(h.had,'—'),'newValue', h.best_tk))
          ELSE jsonb_build_array(jsonb_build_object(
            'field','tracking_number','label','Mã vận đơn bị huỷ','oldValue', coalesce(h.had,'—'),'newValue','Đã hủy'))
        END);
    END LOOP;

    -- (3b) Ghi mã mới / đánh dấu huỷ.
    UPDATE orders o SET
      tracking_number = CASE WHEN d.action IN ('assign','replace') THEN d.best_tk ELSE o.tracking_number END,
      tracking_link   = CASE WHEN d.action IN ('assign','replace') THEN d.best_link ELSE o.tracking_link END,
      tracking_status = CASE WHEN d.action IN ('assign','replace') THEN d.best_status
                             WHEN d.action = 'cancelled' THEN 'Đã hủy'
                             ELSE o.tracking_status END,
      updated_at = now()
    FROM _sync_dec d
    WHERE o.id = d.oid AND d.action IN ('assign','replace','cancelled');
  END IF;

  -- (4) Báo cáo (dựa trên _sync_dec = pre-state, phản ánh đúng việc vừa làm).
  SELECT jsonb_build_object(
    'applied', p_apply,
    'matched', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'tracking',best_tk,'link',best_link,'status',best_status,
        'orderNumber',onum,'orderCustomer',ocust,'receiverName',name,
        'hadTracking', action='replace', 'replaced', action='replace'))
      FROM _sync_dec WHERE action IN ('assign','replace')), '[]'::jsonb),
    'skipped', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'tracking', best_tk, 'orderNumber',onum,'orderCustomer',ocust,'receiverName',name,
        'existingTracking', had, 'sameTracking', action='skip_same'))
      FROM _sync_dec WHERE action IN ('skip_same','skip_existing')), '[]'::jsonb),
    'cancelled', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'orderNumber',onum,'orderCustomer',ocust,'receiverName',name,
        'cancelledTracking', coalesce(had, (cancelled_tks)[1])))
      FROM _sync_dec WHERE action='cancelled'), '[]'::jsonb),
    'unmatched', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'tracking',tracking,'receiverName',name,'phone',phone9))
      FROM _sync_res WHERE oid IS NULL AND NOT is_cancel), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result || jsonb_build_object(
    'matchedCount',   jsonb_array_length(v_result->'matched'),
    'skippedCount',   jsonb_array_length(v_result->'skipped'),
    'cancelledCount', jsonb_array_length(v_result->'cancelled'),
    'unmatchedCount', jsonb_array_length(v_result->'unmatched'));
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Đồng bộ TIỀN THU HỘ (COD) từ file giao dịch ví SPX.
-- p_rows = [{txId, tracking, amount, date}] — chỉ các dòng "Tiền thu hộ" có mã SPXVN (FE đã lọc).
--   txId    = "Mã giao dịch" ví SPX (duy nhất) → dùng làm transactions.id ⇒ chống ghi trùng qua PK.
--   tracking= "Mã vận đơn" SPXVN → khớp orders.tracking_number (loại đơn CANCELLED).
--   amount  = "Số tiền" thu hộ (VND, > 0) → cộng vào orders.paid_amount.
-- p_apply=false → chỉ preview; true → tạo 1 transaction (gateway='spx', in) + cộng paid_amount +
--   suy lại payment_status (order_derive_pay_status) ⇒ đơn "cọc trước + ship COD" tự chuyển sang PAID.
-- Trả {matched[], unmatched[], duplicate[], applied, matchedCount, unmatchedCount, duplicateCount}.
CREATE OR REPLACE FUNCTION order_sync_cod(p_rows jsonb, p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r jsonb;
  v_txid text; v_tracking text; v_amount numeric; v_date text;
  v_oid text; v_onum text; v_ocust text; v_total numeric; v_paid numeric; v_pstatus text;
  v_paid_new numeric; v_status_new text;
  v_dup_order text;
  v_now timestamptz := now();
  v_matched   jsonb := '[]'::jsonb;
  v_unmatched jsonb := '[]'::jsonb;
  v_duplicate jsonb := '[]'::jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    v_txid     := NULLIF(trim(r->>'txId'), '');
    v_tracking := NULLIF(trim(r->>'tracking'), '');
    v_amount   := COALESCE(NULLIF(regexp_replace(COALESCE(r->>'amount', ''), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    v_date     := NULLIF(trim(r->>'date'), '');

    -- Bỏ dòng thiếu dữ liệu / số tiền không hợp lệ.
    CONTINUE WHEN v_txid IS NULL OR v_tracking IS NULL OR v_amount <= 0;

    -- Chống ghi trùng: đã import txId này rồi (kể cả lần upload trước) → không cộng lại.
    v_dup_order := NULL;
    SELECT order_number INTO v_dup_order FROM transactions WHERE id = v_txid LIMIT 1;
    IF FOUND THEN
      v_duplicate := v_duplicate || jsonb_build_object(
        'txId', v_txid, 'tracking', v_tracking, 'amount', v_amount, 'orderNumber', v_dup_order);
      CONTINUE;
    END IF;

    -- Khớp đơn theo mã vận đơn (loại CANCELLED), ưu tiên đơn mới nhất.
    v_oid := NULL; v_onum := NULL; v_ocust := NULL; v_total := NULL; v_paid := NULL; v_pstatus := NULL;
    SELECT o.id, o.order_number, o.customer_name, o.total, o.paid_amount, o.payment_status
      INTO v_oid, v_onum, v_ocust, v_total, v_paid, v_pstatus
    FROM orders o
    WHERE o.tracking_number = v_tracking
      AND COALESCE(o.status, '') <> 'CANCELLED'
    ORDER BY o.created_at DESC NULLS LAST
    LIMIT 1;

    IF v_oid IS NOT NULL THEN
      v_paid_new := COALESCE(v_paid, 0) + v_amount;
      -- Giữ REFUNDED nếu đơn đã hoàn; còn lại suy từ paid vs total.
      v_status_new := order_derive_pay_status(
        v_paid_new, v_total, CASE WHEN v_pstatus = 'REFUNDED' THEN 'REFUNDED' ELSE NULL END);

      IF p_apply THEN
        INSERT INTO transactions (
          id, gateway, transaction_date, content, transfer_type, transfer_amount,
          reference_code, description, order_number, is_external, received_at, created_at
        ) VALUES (
          v_txid, 'spx', COALESCE(v_date, to_char(v_now, 'YYYY/MM/DD HH24:MI:SS')),
          'COD SPX ' || v_tracking, 'in', v_amount,
          v_tracking, 'Tiền thu hộ SPX (' || v_tracking || ')', v_onum, false, v_now, v_now
        );
        UPDATE orders
           SET paid_amount = v_paid_new, payment_status = v_status_new, updated_at = v_now
         WHERE id = v_oid;
      END IF;

      v_matched := v_matched || jsonb_build_object(
        'txId', v_txid, 'tracking', v_tracking, 'amount', v_amount,
        'orderNumber', v_onum, 'orderCustomer', v_ocust,
        'total', v_total, 'paidBefore', COALESCE(v_paid, 0), 'paidAfter', v_paid_new,
        'remainingAfter', GREATEST(COALESCE(v_total, 0) - v_paid_new, 0),
        'statusAfter', v_status_new);
    ELSE
      v_unmatched := v_unmatched || jsonb_build_object(
        'txId', v_txid, 'tracking', v_tracking, 'amount', v_amount);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'matched', v_matched, 'unmatched', v_unmatched, 'duplicate', v_duplicate,
    'applied', p_apply,
    'matchedCount', jsonb_array_length(v_matched),
    'unmatchedCount', jsonb_array_length(v_unmatched),
    'duplicateCount', jsonb_array_length(v_duplicate));
END;
$$;
