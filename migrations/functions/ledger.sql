-- ============================================================
-- Domain: ledger — "Sổ Giao Dịch" thống nhất (thu + chi 1 sổ).
--
-- Mục tiêu: thay vì FE ghép trạng thái từ 5–6 cờ rời rạc
-- (is_external, settled_out, cost_excluded, expense_category, needs_review,
--  order_refunds.transaction_id, manual_expenses.transaction_id),
-- BE tính SẴN 1 cột `status` thống nhất + hỗ trợ filter / phân trang / summary
-- server-side trong MỘT lần gọi.
--
-- status:
--   Tiền VÀO (in):   matched | shopee | external | unmatched
--   Tiền RA  (out):  refund | settled | excluded | expense | stock | unmatched
--
-- Ngày lọc dùng revenue_try_ts() (parse text an toàn, né bug iOS Invalid Date) —
-- KHÔNG cần migrate transaction_date sang timestamptz.
-- Đọc-thuần (STABLE), không ghi. Idempotent (CREATE OR REPLACE).
-- ============================================================

-- Suy ra trạng thái thống nhất cho 1 giao dịch (dùng lại ở list + summary).
CREATE OR REPLACE FUNCTION transaction_ledger_status(t transactions)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    -- Giao dịch TEST (tiền vào TK test) — nhãn riêng, không tính vào doanh thu/đối soát.
    WHEN COALESCE(t.is_test, false) THEN 'test'
    WHEN t.transfer_type = 'in' THEN
      CASE
        -- Khớp 1 đơn cụ thể = mạnh nhất (đối soát chính xác).
        WHEN t.order_number IS NOT NULL AND t.order_number <> '' THEN 'matched'
        -- Đánh dấu tay "Cấp vốn" (tiền chủ bơm vào — set expense_category='capital', KHÔNG phải doanh thu).
        WHEN t.expense_category = 'capital' THEN 'capital'
        -- Đánh dấu tay "Shopee thanh toán" (set expense_category='shopee').
        WHEN t.expense_category = 'shopee' THEN 'shopee'
        -- User chủ động đánh dấu ngoài hệ thống → override auto-detect bên dưới.
        WHEN COALESCE(t.is_external, false) THEN 'external'
        -- Auto-detect: nội dung CK chứa "shopee" → tiền Shopee đổ về (settlement).
        WHEN t.content ILIKE '%shopee%' THEN 'shopee'
        ELSE 'unmatched'
      END
    ELSE -- out
      CASE
        WHEN EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = t.id) THEN 'refund'
        WHEN COALESCE(t.settled_out, false) THEN 'settled'
        WHEN COALESCE(t.cost_excluded, false)
          OR t.expense_category IN ('personal', 'owner', 'internal') THEN 'excluded'
        WHEN EXISTS (SELECT 1 FROM manual_expenses me WHERE me.transaction_id = t.id)
          OR expense_category_is_cost(t.expense_category) THEN 'expense'
        -- Đã gắn phiếu nhập (tiền phiếu tính riêng ở stock_in → KHÔNG cộng OPEX):
        -- chỉ để hiển thị "đã đối soát", đặt SAU expense/excluded để không lấn.
        WHEN EXISTS (SELECT 1 FROM stock_receipts sr WHERE sr.transaction_id = t.id) THEN 'stock'
        ELSE 'unmatched'
      END
  END;
$$;

-- Sổ giao dịch: list (phân trang) + total + summary trong 1 lần gọi.
--   p_from / p_to : text ISO (yyyy-mm-dd hoặc full ts). NULL/'' = mở biên.
--   p_type        : 'in' | 'out' | NULL (cả 2)         — CHỈ lọc list, KHÔNG lọc summary.
--   p_status      : 1 trong các status trên | NULL     — CHỈ lọc list, KHÔNG lọc summary.
--   p_category    : expense_category | NULL            — lọc cả list + summary.
--   p_gateway     : ngân hàng | NULL                   — lọc cả list + summary.
--   p_search      : từ khoá (content/description/order_number/account_number) | NULL.
--   p_limit       : số dòng/trang (mặc định 50, tối đa 200).
--   p_offset      : bỏ qua bao nhiêu dòng.
-- Summary phản ánh kỳ (date+search+category+gateway) — KHÔNG phụ thuộc type/status
-- để Tổng thu / Tổng chi / Số dư ổn định khi user đổi tab loại/trạng thái.
CREATE OR REPLACE FUNCTION transaction_ledger(
  p_from     text DEFAULT NULL,
  p_to       text DEFAULT NULL,
  p_type     text DEFAULT NULL,
  p_status   text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_gateway  text DEFAULT NULL,
  p_search   text DEFAULT NULL,
  p_limit    int  DEFAULT 50,
  p_offset   int  DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_from    timestamptz := revenue_try_ts(NULLIF(p_from, ''));
  v_to      timestamptz := revenue_try_ts(NULLIF(p_to, ''));
  v_type    text := NULLIF(p_type, '');
  v_status  text := NULLIF(p_status, '');
  v_cat     text := NULLIF(p_category, '');
  v_gw      text := NULLIF(p_gateway, '');
  v_q       text := NULLIF(TRIM(p_search), '');
  v_limit   int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset  int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_result  jsonb;
BEGIN
  WITH filt AS (
      -- Base: date + search + category + gateway (KHÔNG type/status) + status derive.
      SELECT t.*, transaction_ledger_status(t) AS status,
             revenue_try_ts(t.transaction_date) AS tx_ts
      FROM transactions t
      WHERE (v_from IS NULL OR revenue_try_ts(t.transaction_date) >= v_from)
        AND (v_to   IS NULL OR revenue_try_ts(t.transaction_date) <= v_to)
        AND (v_gw   IS NULL OR t.gateway = v_gw)
        AND (v_cat  IS NULL OR t.expense_category = v_cat)
        AND (v_q    IS NULL OR (
              t.content       ILIKE '%' || v_q || '%'
           OR t.description   ILIKE '%' || v_q || '%'
           OR t.order_number  ILIKE '%' || v_q || '%'
           OR t.account_number ILIKE '%' || v_q || '%'))
    ),
    listed AS (
      -- List thêm lọc type + status.
      SELECT * FROM filt
      WHERE (v_type   IS NULL OR transfer_type = v_type)
        AND (v_status IS NULL OR status = v_status)
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'sepayId', sepay_id,
          'gateway', gateway,
          'transactionDate', transaction_date,
          'accountNumber', account_number,
          'code', code,
          'content', content,
          'transferType', transfer_type,
          'transferAmount', transfer_amount,
          'accumulated', accumulated,
          'subAccount', sub_account,
          'referenceCode', reference_code,
          'description', description,
          'orderNumber', order_number,
          'isExternal', COALESCE(is_external, false),
          'settledOut', COALESCE(settled_out, false),
          'expenseCategory', expense_category,
          'costExcluded', COALESCE(cost_excluded, false),
          'needsReview', COALESCE(needs_review, false),
          'reviewNote', review_note,
          'receivedAt', received_at,
          'createdAt', created_at,
          'status', status
        ) ORDER BY tx_ts DESC NULLS LAST, created_at DESC NULLS LAST)
        FROM (
          SELECT * FROM listed
          ORDER BY tx_ts DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT v_limit OFFSET v_offset
        ) page
      ), '[]'::jsonb),
      'total', (SELECT count(*)::int FROM listed),
      'summary', (
        SELECT jsonb_build_object(
          'totalIn',  COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'in'), 0),
          'totalOut', COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'out'), 0),
          'net',      COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'in'), 0)
                    - COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'out'), 0),
          'count',      count(*)::int,
          'inCount',    count(*) FILTER (WHERE transfer_type = 'in')::int,
          'outCount',   count(*) FILTER (WHERE transfer_type = 'out')::int,
          'reconciledCount',   count(*) FILTER (WHERE status <> 'unmatched')::int,
          'unreconciledCount', count(*) FILTER (WHERE status = 'unmatched')::int,
          'reconciledPct', CASE WHEN count(*) = 0 THEN 100
            ELSE round(count(*) FILTER (WHERE status <> 'unmatched')::numeric * 100 / count(*))::int END
        )
        -- Summary sổ/đối soát KHÔNG tính giao dịch test (chúng vẫn hiện trong list, nhãn 'test').
        FROM filt WHERE COALESCE(is_test, false) = false
      )
    ) INTO v_result;
  RETURN v_result;
END;
$$;

-- Chuỗi thu/chi theo NGÀY trong kỳ (cho biểu đồ). Trả jsonb array [{day, in, out}]
-- sắp theo ngày tăng dần. Chỉ tính GD có ngày parse được. Đọc-thuần.
CREATE OR REPLACE FUNCTION transaction_ledger_series(
  p_from text DEFAULT NULL,
  p_to   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', to_char(d, 'YYYY-MM-DD'),
           'in',  total_in,
           'out', total_out
         ) ORDER BY d), '[]'::jsonb)
  FROM (
    SELECT date_trunc('day', revenue_try_ts(t.transaction_date)) AS d,
           SUM(t.transfer_amount) FILTER (WHERE t.transfer_type = 'in')  AS total_in,
           SUM(t.transfer_amount) FILTER (WHERE t.transfer_type = 'out') AS total_out
    FROM transactions t
    WHERE revenue_try_ts(t.transaction_date) IS NOT NULL
      AND (revenue_try_ts(NULLIF(p_from, '')) IS NULL
           OR revenue_try_ts(t.transaction_date) >= revenue_try_ts(p_from))
      AND (revenue_try_ts(NULLIF(p_to, '')) IS NULL
           OR revenue_try_ts(t.transaction_date) <= revenue_try_ts(p_to))
    GROUP BY 1
  ) s;
$$;
