-- ============================================================
-- Đối soát TỰ ĐỘNG cho Sổ giao dịch — 1 nút quét cả tiền vào lẫn tiền ra
-- trong khoảng ngày đang xem, gợi ý các cặp CHẮC CHẮN rồi mới ghi.
--
-- 3 loại ghép:
--   (A) tiền VÀO  ↔ đơn hàng            → ghi bằng transaction_reconcile_apply
--   (B) tiền RA   ↔ phiếu nhập kho      → ghi bằng receipt_alloc_add (MỚI ở file này)
--   (C) tiền RA   ↔ chi phí nhập tay    → ghi bằng expense_out_reconcile_apply
--
-- Nguyên tắc chung (giống 2 bộ đối soát đã có): CHỈ gợi ý khi 1–1 tuyệt đối —
-- giao dịch có đúng 1 ứng viên VÀ ứng viên đó chỉ được đúng 1 giao dịch nhắm tới.
-- Nhập nhằng thì bỏ qua và đếm vào `skipped*` để người dùng tự xử ở modal đối soát tay.
--
-- ⚠️ Một giao dịch tiền ra chỉ được thuộc MỘT loại: nếu nó vừa khớp phiếu nhập vừa
-- khớp chi phí tay thì loại khỏi cả (B) lẫn (C) — ghi cả hai sẽ đếm trùng chi phí.
--
-- File 'l...' apply SAU 'expense_reconcile.sql' ('e...'), 'receipt_allocations.sql' ('r...')
-- và 'transactions.sql' ('t...') — các hàm nền đã sẵn. Idempotent (CREATE OR REPLACE).
-- ============================================================

-- Ngày giao dịch dạng date, parse an toàn khỏi cột text (né bug Invalid Date).
CREATE OR REPLACE FUNCTION ledger_tx_date(p_text text)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim(COALESCE(p_text, '')), '')::timestamptz;
$$;

-- ── (B) Tiền RA ↔ phiếu nhập kho ────────────────────────────
-- Giao dịch đủ điều kiện: tiền ra, chưa dính hoàn/chi tay/ship, và CHƯA rải đồng nào
-- (remaining = transfer_amount) — GD đã rải dở thì để người dùng tự rải nốt cho chủ động.
-- Phiếu ứng viên: chưa reconciled, còn nợ > 0, ngày phiếu trong ±p_window_days.
-- Khớp khi: số tiền GD = ĐÚNG phần còn nợ của phiếu (trả đúng 1 bill 1 lần).
--
-- Trả MỌI cặp ứng viên kèm `cand`/`claims` thay vì chỉ cặp sạch: preview cần biết cả
-- những GD có ứng viên nhưng nhập nhằng để đếm vào `ambiguousOut` — lọc sẵn ở đây thì
-- chúng biến mất khỏi mọi con số và người dùng tưởng sổ đã sạch.
-- Đổi danh sách cột trả về thì CREATE OR REPLACE không đủ ("cannot change return type").
DROP FUNCTION IF EXISTS ledger_auto_receipt_pairs(text, text, int);
CREATE OR REPLACE FUNCTION ledger_auto_receipt_pairs(
  p_from text,
  p_to text,
  p_window_days int DEFAULT 3
)
RETURNS TABLE (
  tx_id text,
  tx_amount numeric,
  tx_date timestamptz,
  descr text,
  receipt_id text,
  receipt_total numeric,
  receipt_remaining numeric,
  receipt_date date,
  supplier text,
  invoice text,
  /** Số phiếu ứng viên của GD này / số GD nhắm vào phiếu này — =1 cả hai là cặp sạch. */
  cand bigint,
  claims bigint
)
LANGUAGE sql STABLE AS $$
  WITH tx AS (
    SELECT t.id AS tx_id,
           t.transfer_amount AS tx_amount,
           ledger_tx_date(t.transaction_date) AS tx_date,
           left(COALESCE(NULLIF(t.content, ''), t.description, ''), 80) AS descr
    FROM transactions t
    WHERE expense_out_reconcilable(t)
      AND COALESCE(t.is_test, false) = false
      AND ledger_tx_date(t.transaction_date) IS NOT NULL
      AND (NULLIF(p_from, '') IS NULL OR ledger_tx_date(t.transaction_date) >= p_from::timestamptz)
      AND (NULLIF(p_to, '')   IS NULL OR ledger_tx_date(t.transaction_date) <= p_to::timestamptz)
      -- Chưa rải cho phiếu nào (rải dở → người dùng đang tự làm, đừng chen vào).
      AND receipt_tx_allocated(t.id) = 0
  ),
  bill AS (
    SELECT s.id AS receipt_id,
           COALESCE(s.total_amount, 0) AS receipt_total,
           COALESCE(s.total_amount, 0)
             - COALESCE((SELECT sum(x.amount) FROM receipt_tx_allocations x WHERE x.receipt_id = s.id), 0)
             AS receipt_remaining,
           receipt_safe_date(s.receipt_date) AS receipt_date,
           COALESCE(NULLIF(s.supplier_name_canonical, ''), s.supplier_name_raw, '') AS supplier,
           COALESCE(s.invoice_number, '') AS invoice
    FROM stock_receipts s
    WHERE COALESCE(s.reconciled, false) = false
      AND receipt_safe_date(s.receipt_date) IS NOT NULL
  ),
  pairs AS (
    SELECT tx.tx_id, tx.tx_amount, tx.tx_date, tx.descr,
           bill.receipt_id, bill.receipt_total, bill.receipt_remaining,
           bill.receipt_date, bill.supplier, bill.invoice
    FROM tx JOIN bill
      ON bill.receipt_remaining = tx.tx_amount
     AND bill.receipt_remaining > 0
     AND bill.receipt_date BETWEEN (tx.tx_date::date - p_window_days)
                               AND (tx.tx_date::date + p_window_days)
  ),
  tx_counts AS (SELECT pairs.tx_id, count(*) AS cand FROM pairs GROUP BY pairs.tx_id),
  bill_counts AS (SELECT pairs.receipt_id, count(*) AS claims FROM pairs GROUP BY pairs.receipt_id)
  SELECT p.tx_id, p.tx_amount, p.tx_date, p.descr,
         p.receipt_id, p.receipt_total, p.receipt_remaining,
         p.receipt_date, p.supplier, p.invoice,
         tc.cand, bc.claims
    FROM pairs p
    JOIN tx_counts tc ON tc.tx_id = p.tx_id
    JOIN bill_counts bc ON bc.receipt_id = p.receipt_id;
$$;

-- ── PREVIEW gộp (dry-run, KHÔNG ghi) ────────────────────────
-- p_from / p_to: text ISO (yyyy-mm-dd hoặc full ts), '' = mở biên — cùng quy ước với ledger_list.
CREATE OR REPLACE FUNCTION ledger_auto_reconcile_preview(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL,
  p_window_days int DEFAULT 3
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH
  -- (A) tiền VÀO ↔ đơn hàng: cùng tiêu chí transaction_reconcile_preview nhưng lọc theo kỳ.
  tx_in AS (
    SELECT t.id AS tx_id, t.sepay_id, t.transfer_amount,
           ledger_tx_date(t.transaction_date) AS tx_date,
           left(COALESCE(NULLIF(t.content, ''), t.description, ''), 80) AS descr
    FROM transactions t
    WHERE t.transfer_type = 'in'
      AND t.order_number IS NULL
      AND COALESCE(t.is_external, false) = false
      AND COALESCE(t.is_test, false) = false
      AND ledger_tx_date(t.transaction_date) IS NOT NULL
      AND (NULLIF(p_from, '') IS NULL OR ledger_tx_date(t.transaction_date) >= p_from::timestamptz)
      AND (NULLIF(p_to, '')   IS NULL OR ledger_tx_date(t.transaction_date) <= p_to::timestamptz)
  ),
  in_pairs AS (
    SELECT u.tx_id, u.sepay_id, u.transfer_amount, u.tx_date, u.descr,
           o.id AS order_id, o.order_number, o.customer_name, o.total, o.created_at
    FROM tx_in u
    JOIN orders o
      ON o.payment_status IS DISTINCT FROM 'PAID'
     AND o.sepay_id IS NULL
     AND o.order_number IS NOT NULL
     AND o.created_at IS NOT NULL
     AND (o.total = u.transfer_amount OR COALESCE(o.deposit_amount, 0) = u.transfer_amount)
     AND u.tx_date >= o.created_at
     AND u.tx_date <= o.created_at + interval '7 days'
  ),
  in_tx_counts AS (SELECT tx_id, count(*) AS cand FROM in_pairs GROUP BY tx_id),
  in_ord_counts AS (SELECT order_id, count(*) AS claims FROM in_pairs GROUP BY order_id),
  in_clean AS (
    SELECT p.* FROM in_pairs p
    JOIN in_tx_counts tc ON tc.tx_id = p.tx_id AND tc.cand = 1
    JOIN in_ord_counts oc ON oc.order_id = p.order_id AND oc.claims = 1
  ),

  -- (B) tiền RA ↔ phiếu nhập kho: mọi cặp ứng viên, rồi lọc cặp 1–1.
  rec_pairs AS (
    SELECT * FROM ledger_auto_receipt_pairs(p_from, p_to, p_window_days)
  ),
  rec_clean AS (
    SELECT * FROM rec_pairs WHERE cand = 1 AND claims = 1
  ),

  -- (C) tiền RA ↔ chi phí nhập tay (cùng tiêu chí expense_out_reconcile_preview + lọc kỳ).
  tx_out AS (
    SELECT t.id AS tx_id, t.transfer_amount,
           ledger_tx_date(t.transaction_date) AS tx_date,
           left(COALESCE(NULLIF(t.content, ''), t.description, ''), 80) AS descr
    FROM transactions t
    WHERE expense_out_reconcilable(t)
      AND COALESCE(t.is_test, false) = false
      AND ledger_tx_date(t.transaction_date) IS NOT NULL
      AND (NULLIF(p_from, '') IS NULL OR ledger_tx_date(t.transaction_date) >= p_from::timestamptz)
      AND (NULLIF(p_to, '')   IS NULL OR ledger_tx_date(t.transaction_date) <= p_to::timestamptz)
  ),
  exp_pairs AS (
    SELECT o.tx_id, o.transfer_amount, o.tx_date, o.descr,
           m.id AS exp_id, m.date AS exp_date, m.category, m.note
    FROM tx_out o
    JOIN manual_expenses m
      ON m.transaction_id IS NULL
     AND m.amount = o.transfer_amount
     AND m.date BETWEEN (o.tx_date::date - p_window_days) AND (o.tx_date::date + p_window_days)
  ),
  exp_tx_counts AS (SELECT tx_id, count(*) AS cand FROM exp_pairs GROUP BY tx_id),
  exp_counts AS (SELECT exp_id, count(*) AS claims FROM exp_pairs GROUP BY exp_id),
  exp_clean AS (
    SELECT p.* FROM exp_pairs p
    JOIN exp_tx_counts tc ON tc.tx_id = p.tx_id AND tc.cand = 1
    JOIN exp_counts ec ON ec.exp_id = p.exp_id AND ec.claims = 1
  ),

  -- Giao dịch tiền ra khớp CẢ phiếu nhập lẫn chi phí tay → không biết cái nào đúng,
  -- ghi cả hai thì đếm trùng chi phí → loại khỏi cả hai nhóm.
  conflict AS (
    SELECT tx_id FROM rec_clean INTERSECT SELECT tx_id FROM exp_clean
  ),
  rec_final AS (SELECT * FROM rec_clean WHERE tx_id NOT IN (SELECT tx_id FROM conflict)),
  exp_final AS (SELECT * FROM exp_clean WHERE tx_id NOT IN (SELECT tx_id FROM conflict))

  SELECT jsonb_build_object(
    'inOrders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'transactionId',  tx_id,
        'sepayId',        sepay_id,
        'orderId',        order_id,
        'orderNumber',    order_number,
        'customer',       COALESCE(customer_name, ''),
        'orderTotal',     total,
        'amount',         transfer_amount,
        'transactionDate', tx_date,
        'orderCreatedAt', created_at,
        'description',    descr
      ) ORDER BY tx_date DESC) FROM in_clean), '[]'::jsonb),

    'outReceipts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'transactionId',   tx_id,
        'receiptId',       receipt_id,
        'amount',          tx_amount,
        'transactionDate', tx_date,
        'receiptDate',     receipt_date,
        'receiptTotal',    receipt_total,
        'receiptRemaining', receipt_remaining,
        'supplier',        supplier,
        'invoice',         invoice,
        'description',     descr
      ) ORDER BY tx_date DESC) FROM rec_final), '[]'::jsonb),

    'outExpenses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'transactionId',   tx_id,
        'expenseId',       exp_id,
        'amount',          transfer_amount,
        'transactionDate', tx_date,
        'expenseDate',     exp_date,
        'category',        category,
        'note',            COALESCE(note, ''),
        'description',     descr
      ) ORDER BY tx_date DESC) FROM exp_final), '[]'::jsonb),

    'counts', jsonb_build_object(
      'unmatchedIn',  (SELECT count(*)::int FROM tx_in),
      'unmatchedOut', (SELECT count(*)::int FROM tx_out),
      -- Có ứng viên nhưng không 1–1 → phải đối soát tay.
      'ambiguousIn',  (SELECT count(*)::int FROM tx_in u
                        WHERE EXISTS (SELECT 1 FROM in_pairs p WHERE p.tx_id = u.tx_id)
                          AND NOT EXISTS (SELECT 1 FROM in_clean c WHERE c.tx_id = u.tx_id)),
      -- Tính cả ứng viên phiếu nhập lẫn chi phí tay: GD trùng tiền với 2 phiếu cũng là
      -- nhập nhằng, bỏ sót thì người dùng tưởng sổ đã sạch.
      'ambiguousOut', (SELECT count(*)::int FROM tx_out o
                        WHERE (EXISTS (SELECT 1 FROM exp_pairs p WHERE p.tx_id = o.tx_id)
                            OR EXISTS (SELECT 1 FROM rec_pairs r WHERE r.tx_id = o.tx_id))
                          AND NOT EXISTS (SELECT 1 FROM exp_final c WHERE c.tx_id = o.tx_id)
                          AND NOT EXISTS (SELECT 1 FROM rec_final r WHERE r.tx_id = o.tx_id)),
      -- GD ra khớp cả bill lẫn chi phí tay → bỏ qua có chủ đích, nói rõ cho người dùng.
      'conflictOut',  (SELECT count(*)::int FROM conflict)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── APPLY gộp ───────────────────────────────────────────────
-- p_payload = { inOrders: [...], outReceipts: [...], outExpenses: [...] } — đúng các cặp
-- người dùng còn tick ở modal preview. Atomic (1 function = 1 transaction) + idempotent:
-- mọi hàm apply bên dưới đều tự bỏ qua cặp không còn hợp lệ.
CREATE OR REPLACE FUNCTION ledger_auto_reconcile_apply(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_in jsonb := COALESCE(p_payload->'inOrders', '[]'::jsonb);
  v_rec jsonb := COALESCE(p_payload->'outReceipts', '[]'::jsonb);
  v_exp jsonb := COALESCE(p_payload->'outExpenses', '[]'::jsonb);
  v_in_res jsonb := jsonb_build_object('applied', 0, 'skipped', 0);
  v_exp_res jsonb := jsonb_build_object('applied', 0, 'skipped', 0);
  v_item jsonb;
  v_tx text;
  v_receipt text;
  v_rec_applied int := 0;
  v_rec_skipped int := 0;
BEGIN
  IF jsonb_typeof(v_in) = 'array' AND jsonb_array_length(v_in) > 0 THEN
    v_in_res := transaction_reconcile_apply(v_in);
  END IF;

  IF jsonb_typeof(v_exp) = 'array' AND jsonb_array_length(v_exp) > 0 THEN
    v_exp_res := expense_out_reconcile_apply(v_exp);
  END IF;

  -- Phiếu nhập: rải nguyên số tiền GD vào phiếu. receipt_alloc_add tự validate
  -- (tiền ra, không dính hoàn/chi tay/ship, không vượt còn-lại) — cặp nào hỏng thì
  -- đếm skipped chứ không làm hỏng cả lô.
  IF jsonb_typeof(v_rec) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_rec) LOOP
      v_tx := NULLIF(v_item->>'transactionId', '');
      v_receipt := NULLIF(v_item->>'receiptId', '');
      IF v_tx IS NULL OR v_receipt IS NULL THEN
        v_rec_skipped := v_rec_skipped + 1;
        CONTINUE;
      END IF;
      BEGIN
        PERFORM receipt_alloc_add(jsonb_build_object(
          'receiptId', v_receipt,
          'transactionId', v_tx,
          'amount', NULLIF(v_item->>'amount', '')::numeric
        ));
        v_rec_applied := v_rec_applied + 1;
      EXCEPTION WHEN OTHERS THEN
        v_rec_skipped := v_rec_skipped + 1;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'inOrders',    v_in_res,
    'outReceipts', jsonb_build_object('applied', v_rec_applied, 'skipped', v_rec_skipped),
    'outExpenses', v_exp_res,
    'applied', COALESCE((v_in_res->>'applied')::int, 0)
             + v_rec_applied
             + COALESCE((v_exp_res->>'applied')::int, 0),
    'skipped', COALESCE((v_in_res->>'skipped')::int, 0)
             + v_rec_skipped
             + COALESCE((v_exp_res->>'skipped')::int, 0)
  );
END;
$$;
