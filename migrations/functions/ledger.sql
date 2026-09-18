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
--   Tiền VÀO (in):   matched | shopee | capital | sweep_in  | external | unmatched
--   Tiền RA  (out):  refund | shipping | sweep_out | settled | excluded | expense | stock | unmatched
--
-- 099 — DÒNG TIỀN 2 TÀI KHOẢN (payment_accounts.purpose):
--   TK NHẬN ('receive') nhận tiền khách → CUỐI NGÀY dồn sang TK CHI ('spend') → TK chi
--   thanh toán hoá đơn. Cú dồn tiền tạo 2 GD của CÙNG 1 dòng tiền: ra ở TK nhận
--   (`sweep_out`) + vào ở TK chi (`sweep_in`) → luân chuyển NỘI BỘ, tiền chưa vào/ra tiệm
--   nên KHÔNG tính doanh thu/chi phí. Summary tách riêng (sweepIn/sweepOut/netExternal)
--   và `byAccount` cho biết dòng tiền nào thuộc tài khoản nào.
--
-- PHỤ THUỘC (apply trước file này): migrations/099_payment_account_purpose.sql,
-- functions/transactions.sql (payment_account_purpose), functions/expenses.sql.
--
-- Ngày lọc dùng revenue_try_ts() (parse text an toàn, né bug iOS Invalid Date) —
-- KHÔNG cần migrate transaction_date sang timestamptz.
-- Đọc-thuần (STABLE), không ghi. Idempotent (CREATE OR REPLACE).
-- ============================================================

-- Tiền VÀO này có phải tiền dồn cuối ngày từ TK NHẬN sang TK CHI? (099)
-- Điều kiện (chặt, để không ăn nhầm tiền khách CK trực tiếp vào TK chi):
--   1. GD vào 1 TK có purpose='spend' (TK chi), và
--   2. có 1 GD tiền RA từ 1 TK purpose='receive' ĐÃ ĐƯỢC ĐÁNH DẤU là cú dồn tiền
--      (settled_out = true, hoặc expense_category='sweep'), CÙNG số tiền,
--      lệch không quá 2 ngày (dồn cuối ngày có thể về TK chi sang hôm sau).
-- Neo vào GD ra đã đánh dấu TAY → không tự ý loại doanh thu khi chưa ai xác nhận.
CREATE OR REPLACE FUNCTION transaction_is_sweep_in(t transactions)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT payment_account_purpose(t.account_number, t.sub_account) = 'spend'
     AND EXISTS (
       SELECT 1 FROM transactions o
       WHERE o.id <> t.id
         AND o.transfer_type = 'out'
         AND o.transfer_amount = t.transfer_amount
         AND (COALESCE(o.settled_out, false) OR o.expense_category = 'sweep')
         AND payment_account_purpose(o.account_number, o.sub_account) = 'receive'
         AND revenue_try_ts(o.transaction_date) IS NOT NULL
         AND revenue_try_ts(t.transaction_date) IS NOT NULL
         AND revenue_try_ts(o.transaction_date)
             BETWEEN revenue_try_ts(t.transaction_date) - interval '2 days'
                 AND revenue_try_ts(t.transaction_date) + interval '2 days'
     );
$$;

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
        -- Đánh dấu tay "Dồn từ TK nhận" (099) — tiền nội bộ, không phải doanh thu.
        WHEN t.expense_category = 'sweep' THEN 'sweep_in'
        -- Đánh dấu tay "Cấp vốn" (tiền chủ bơm vào — set expense_category='capital', KHÔNG phải doanh thu).
        WHEN t.expense_category = 'capital' THEN 'capital'
        -- Đánh dấu tay "Shopee thanh toán" (set expense_category='shopee').
        WHEN t.expense_category = 'shopee' THEN 'shopee'
        -- User chủ động đánh dấu ngoài hệ thống → override auto-detect bên dưới.
        WHEN COALESCE(t.is_external, false) THEN 'external'
        -- Auto-detect: tiền vào TK CHI khớp 1 cú dồn tiền đã đánh dấu ở TK nhận (099).
        WHEN transaction_is_sweep_in(t) THEN 'sweep_in'
        -- Auto-detect: nội dung CK chứa "shopee" → tiền Shopee đổ về (settlement).
        WHEN t.content ILIKE '%shopee%' THEN 'shopee'
        ELSE 'unmatched'
      END
    ELSE -- out
      CASE
        WHEN EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = t.id) THEN 'refund'
        -- Đã gắn thanh toán vận chuyển (ship cho đơn / nhà xe) — đặt TRƯỚC 'expense' để không
        -- hiện 'expense' dù category='shipping' (shipping vẫn là chi phí, P&L đếm 1 lần).
        WHEN EXISTS (SELECT 1 FROM shipping_payments sp WHERE sp.transaction_id = t.id) THEN 'shipping'
        -- Dồn tiền cuối ngày TK NHẬN → TK CHI (099): đánh dấu tay category='sweep', hoặc
        -- cờ settled_out cũ trên 1 TK nhận (nghĩa cũ "kết toán về TK chính" = đúng cú dồn này).
        WHEN t.expense_category = 'sweep'
          OR (COALESCE(t.settled_out, false)
              AND payment_account_purpose(t.account_number, t.sub_account) = 'receive')
          THEN 'sweep_out'
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
--   p_account     : payment_accounts.id | NULL (099)   — lọc cả list + summary.
-- Summary phản ánh kỳ (date+search+category+gateway+account) — KHÔNG phụ thuộc type/status
-- để Tổng thu / Tổng chi / Số dư ổn định khi user đổi tab loại/trạng thái.
-- Mỗi dòng kèm TÀI KHOẢN của nó (accountId/accountLabel/accountPurpose) → sổ nói rõ
-- dòng tiền nào chạy qua tài khoản nào.
-- Thêm tham số p_account (099) → ĐỔI signature. CREATE OR REPLACE khác số tham số sẽ
-- tạo OVERLOAD mới, bản 9 tham số cũ còn đó → gọi 9 args bị "function is not unique".
DROP FUNCTION IF EXISTS transaction_ledger(text, text, text, text, text, text, text, int, int);

CREATE OR REPLACE FUNCTION transaction_ledger(
  p_from     text DEFAULT NULL,
  p_to       text DEFAULT NULL,
  p_type     text DEFAULT NULL,
  p_status   text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_gateway  text DEFAULT NULL,
  p_search   text DEFAULT NULL,
  p_limit    int  DEFAULT 50,
  p_offset   int  DEFAULT 0,
  p_account  text DEFAULT NULL
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
  v_acct    text := NULLIF(TRIM(p_account), '');
  v_limit   int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset  int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_result  jsonb;
BEGIN
  WITH filt AS (
      -- Base: date + search + category + gateway + account (KHÔNG type/status) + status derive.
      SELECT t.*, transaction_ledger_status(t) AS status,
             revenue_try_ts(t.transaction_date) AS tx_ts,
             acc.id AS acct_id, acc.purpose AS acct_purpose,
             acc.bank_code AS acct_bank, acc.account_number AS acct_number,
             acc.account_holder AS acct_holder,
             -- Nhãn ngắn hiển thị ở sổ: "BIDV ·1308" (4 số cuối, khỏi phơi cả số TK).
             CASE WHEN acc.id IS NULL THEN NULL
                  ELSE acc.bank_code || ' ·' || right(acc.account_number, 4) END AS acct_label
      FROM transactions t
      -- LATERAL + LIMIT 1: nhiều TK khai cùng số → lấy 1 dòng, không nhân bản giao dịch.
      LEFT JOIN LATERAL (
        SELECT pa.id, pa.purpose, pa.bank_code, pa.account_number, pa.account_holder
        FROM payment_accounts pa
        WHERE pa.account_number IN (NULLIF(TRIM(COALESCE(t.account_number, '')), ''),
                                    NULLIF(TRIM(COALESCE(t.sub_account, '')), ''))
        ORDER BY pa.is_active DESC, pa.created_at DESC
        LIMIT 1
      ) acc ON true
      WHERE (v_from IS NULL OR revenue_try_ts(t.transaction_date) >= v_from)
        AND (v_to   IS NULL OR revenue_try_ts(t.transaction_date) <= v_to)
        AND (v_gw   IS NULL OR t.gateway = v_gw)
        AND (v_cat  IS NULL OR t.expense_category = v_cat)
        AND (v_acct IS NULL OR acc.id = v_acct)
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
    ),
    -- Kỳ "sạch" dùng cho mọi con số tổng: bỏ giao dịch test (vẫn hiện trong list, nhãn 'test').
    real_tx AS (
      SELECT * FROM filt WHERE COALESCE(is_test, false) = false
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
          'status', status,
          -- 099: tài khoản của dòng tiền này (NULL = TK chưa khai trong payment_accounts).
          'accountId', acct_id,
          'accountLabel', acct_label,
          'accountPurpose', acct_purpose
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
          -- 099: luân chuyển NỘI BỘ (TK nhận → TK chi). Nằm trong totalIn/totalOut (đó là
          -- dòng tiền thật trên bank), tách ra để biết phần nào không phải thu/chi của tiệm.
          'sweepIn',  COALESCE(SUM(transfer_amount) FILTER (WHERE status = 'sweep_in'), 0),
          'sweepOut', COALESCE(SUM(transfer_amount) FILTER (WHERE status = 'sweep_out'), 0),
          -- Thu/chi THỰC với bên ngoài = tổng trừ phần luân chuyển nội bộ.
          'externalIn',  COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'in'), 0)
                       - COALESCE(SUM(transfer_amount) FILTER (WHERE status = 'sweep_in'), 0),
          'externalOut', COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'out'), 0)
                       - COALESCE(SUM(transfer_amount) FILTER (WHERE status = 'sweep_out'), 0),
          'netExternal', (COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'in'), 0)
                        - COALESCE(SUM(transfer_amount) FILTER (WHERE status = 'sweep_in'), 0))
                       - (COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'out'), 0)
                        - COALESCE(SUM(transfer_amount) FILTER (WHERE status = 'sweep_out'), 0)),
          'count',      count(*)::int,
          'inCount',    count(*) FILTER (WHERE transfer_type = 'in')::int,
          'outCount',   count(*) FILTER (WHERE transfer_type = 'out')::int,
          'reconciledCount',   count(*) FILTER (WHERE status <> 'unmatched')::int,
          'unreconciledCount', count(*) FILTER (WHERE status = 'unmatched')::int,
          'reconciledPct', CASE WHEN count(*) = 0 THEN 100
            ELSE round(count(*) FILTER (WHERE status <> 'unmatched')::numeric * 100 / count(*))::int END
        )
        FROM real_tx
      ),
      -- 099: dòng tiền tách theo TỪNG tài khoản (TK nhận / TK chi / TK chưa khai).
      'byAccount', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'accountId',     a.acct_id,
                 'label',         COALESCE(a.acct_label, 'TK chưa khai'),
                 'bankCode',      a.acct_bank,
                 'accountNumber', a.acct_number,
                 'accountHolder', a.acct_holder,
                 'purpose',       a.acct_purpose,
                 'in',            a.t_in,
                 'out',           a.t_out,
                 'net',           a.t_in - a.t_out,
                 'sweepIn',       a.s_in,
                 'sweepOut',      a.s_out,
                 'count',         a.cnt
               ) ORDER BY a.acct_purpose NULLS LAST, (a.t_in + a.t_out) DESC)
        FROM (
          SELECT acct_id, acct_label, acct_bank, acct_number, acct_holder, acct_purpose,
                 COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'in'), 0)  AS t_in,
                 COALESCE(SUM(transfer_amount) FILTER (WHERE transfer_type = 'out'), 0) AS t_out,
                 COALESCE(SUM(transfer_amount) FILTER (WHERE status = 'sweep_in'), 0)   AS s_in,
                 COALESCE(SUM(transfer_amount) FILTER (WHERE status = 'sweep_out'), 0)  AS s_out,
                 count(*)::int AS cnt
          FROM real_tx
          GROUP BY acct_id, acct_label, acct_bank, acct_number, acct_holder, acct_purpose
        ) a
      ), '[]'::jsonb)
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
