-- ============================================================
-- Tồn kho NVL theo ĐƠN NHẬP, mốc mặc định 13/7/2026 (trước đó coi = 0).
-- Giai đoạn 1: chỉ cộng SỐ LƯỢNG NHẬP từ p_from cho mọi dòng item_type='material'
-- (gộp theo material_id để khử trùng tên; dòng chưa gắn material_id gộp theo tên).
-- Tiêu thụ theo đơn (BOM) tính SAU — nên "tồn" hiện = tổng đã nhập.
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
  lines AS (
    SELECT
      coalesce(l.material_id, 'raw:' || lower(btrim(l.name))) AS mkey,
      max(coalesce(m.name, l.name))                    AS name,
      max(coalesce(NULLIF(m.canonical_unit,''), NULLIF(l.unit,''))) AS unit,
      sum(coalesce(l.quantity, 0))                     AS qty_in,
      sum(coalesce(l.line_total, 0))                   AS amount_in,
      count(*)                                         AS receipt_count,
      max(rx.rdate)                                    AS last_date
    FROM stock_receipt_lines l
    JOIN rx ON rx.id = l.receipt_id
    LEFT JOIN materials m ON m.id = l.material_id
    WHERE rx.rdate >= p_from::date
      AND coalesce(l.item_type, '') = 'material'
      AND rx.status <> 'void'
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'materialCount', (SELECT count(*) FROM lines),
    'totalQtyLines', (SELECT coalesce(sum(receipt_count), 0) FROM lines),
    'totalAmount',   (SELECT coalesce(sum(amount_in), 0) FROM lines),
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'key',          mkey,
        'name',         name,
        'unit',         unit,
        'qtyIn',        qty_in,
        'amountIn',     amount_in,
        'receiptCount', receipt_count,
        'lastDate',     last_date
      ) ORDER BY amount_in DESC), '[]'::jsonb)
      FROM lines
    )
  );
$$;
