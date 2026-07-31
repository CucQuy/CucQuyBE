-- ============================================================
-- Tồn kho NVL theo ĐƠN NHẬP, mốc mặc định 13/7/2026 (trước đó coi = 0).
--   • qtyIn   = tổng SỐ LƯỢNG đã nhập từ mốc (gộp theo material_id; dòng chưa gắn
--     material_id gộp theo tên). item_type='material'.
--   • used/remaining = CHỈ tính cho NVL map được ra đơn (computable=true).
--       - Hộp giấy đựng bánh (mini KRAFT): gộp mọi dòng, quy đổi lô×50 = cái;
--         đã dùng = số SP "…tốt nghiệp" bán ra từ mốc; còn lại = nhập − dùng.
--     NVL khác chưa có công thức → used=remaining=null (hiện "—").
-- Read-only, STABLE. Trả jsonb cho FE.
-- ============================================================
CREATE OR REPLACE FUNCTION inventory_overview(p_from timestamptz DEFAULT '2026-07-13')
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH rx AS (
    -- receipt_date là TEXT lẫn 'YYYY-MM-DD' và 'DD/MM/YYYY' → parse an toàn, fallback created_at.
    SELECT r.id,
      CASE
        WHEN r.receipt_date ~ '^\d{4}-\d{1,2}-\d{1,2}' THEN substring(r.receipt_date, 1, 10)::date
        WHEN r.receipt_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(r.receipt_date, 'DD/MM/YYYY')
        ELSE r.created_at::date
      END AS rdate,
      coalesce(r.status, '') AS status
    FROM stock_receipts r
  ),
  raw AS (
    SELECT
      l.material_id AS mid,
      l.name        AS lname,
      coalesce(m.name, l.name) AS mname,
      coalesce(NULLIF(m.canonical_unit, ''), NULLIF(l.unit, '')) AS munit,
      unaccent(lower(coalesce(m.normalized_name, l.name))) AS norm,
      coalesce(l.quantity, 0)   AS qty,
      coalesce(l.line_total, 0) AS amt,
      rx.rdate
    FROM stock_receipt_lines l
    JOIN rx ON rx.id = l.receipt_id
    LEFT JOIN materials m ON m.id = l.material_id
    WHERE rx.rdate >= p_from::date
      AND coalesce(l.item_type, '') = 'material'
      AND rx.status <> 'void'
  ),
  lines AS (
    SELECT
      CASE WHEN bool_or(norm LIKE '%hop giay mini%')
           THEN 'box-hgm'
           ELSE coalesce(max(mid), 'raw:' || lower(btrim(max(lname)))) END AS mkey,
      bool_or(norm LIKE '%hop giay mini%') AS is_box,
      max(mname) AS name,
      max(munit) AS unit,
      sum(qty)   AS qty_raw,
      sum(amt)   AS amount_in,
      count(*)   AS receipt_count,
      max(rdate) AS last_date
    FROM raw
    GROUP BY CASE WHEN norm LIKE '%hop giay mini%'
                  THEN 'box-hgm'
                  ELSE coalesce(mid, 'raw:' || lower(btrim(lname))) END
  ),
  box_used AS (
    SELECT coalesce(sum(oi.quantity), 0) AS used
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE coalesce(o.status, '') <> 'CANCELLED'
      AND o.order_date::date >= p_from::date
      AND unaccent(lower(coalesce(oi.product_name, ''))) LIKE '%tot nghiep%'
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'materialCount', (SELECT count(*) FROM lines),
    'totalQtyLines', (SELECT coalesce(sum(receipt_count), 0) FROM lines),
    'totalAmount',   (SELECT coalesce(sum(amount_in), 0) FROM lines),
    'boxUsed',       (SELECT used FROM box_used),
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'key',          mkey,
        'name',         CASE WHEN is_box THEN 'Hộp giấy đựng bánh (mini KRAFT)' ELSE name END,
        'unit',         CASE WHEN is_box THEN 'cái (lô×50)' ELSE unit END,
        'qtyIn',        CASE WHEN is_box THEN qty_raw * 50 ELSE qty_raw END,
        'amountIn',     amount_in,
        'receiptCount', receipt_count,
        'lastDate',     last_date,
        'computable',   is_box,
        'used',         CASE WHEN is_box THEN (SELECT used FROM box_used) END,
        'remaining',    CASE WHEN is_box THEN qty_raw * 50 - (SELECT used FROM box_used) END
      ) ORDER BY amount_in DESC), '[]'::jsonb)
      FROM lines
    )
  );
$$;
