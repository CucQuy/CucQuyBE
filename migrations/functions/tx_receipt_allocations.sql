-- ============================================================
-- Transaction-first: rải 1 GIAO DỊCH tiền ra ra NHIỀU phiếu nhập.
-- Dùng lại receipt_alloc_* (quan hệ n:n receipt_tx_allocations đã có).
-- File 't...' apply SAU 'receipt_allocations.sql' ('r...') → các hàm receipt_alloc_* đã sẵn.
-- ============================================================

-- Tổng hợp phân bổ theo phía GIAO DỊCH (cho panel "rải nhiều phiếu" ở màn Sổ/Giao dịch).
--  - txAmount/allocated/remaining: tiền GD, đã rải, còn lại.
--  - allocations[]: các phiếu GD này đang gắn (kèm id alloc để gỡ).
--  - candidates[]: phiếu CHƯA đối soát, còn nợ > 0, chưa gắn GD này (tối đa 100 phiếu gần nhất).
CREATE OR REPLACE FUNCTION tx_receipt_alloc_summary(p_tx_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'transactionId', t.id,
    'txAmount',      t.transfer_amount,
    'allocated',     receipt_tx_allocated(t.id),
    'remaining',     receipt_tx_remaining(t.id),
    'allocations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',            a.id,
        'receiptId',     a.receipt_id,
        'amount',        a.amount,
        'receiptTotal',  s.total_amount,
        'receiptDate',   receipt_safe_date(s.receipt_date),
        'supplier',      COALESCE(NULLIF(s.supplier_name_canonical, ''), s.supplier_name_raw),
        'invoice',       s.invoice_number,
        'receiptReconciled', COALESCE(s.reconciled, false)
      ) ORDER BY a.created_at)
      FROM receipt_tx_allocations a JOIN stock_receipts s ON s.id = a.receipt_id
      WHERE a.transaction_id = t.id), '[]'::jsonb),
    'candidates', COALESCE((
      SELECT jsonb_agg(c) FROM (
        SELECT jsonb_build_object(
          'receiptId',   s.id,
          'total',       s.total_amount,
          'paid',        COALESCE((SELECT sum(x.amount) FROM receipt_tx_allocations x WHERE x.receipt_id = s.id), 0),
          'remaining',   GREATEST(COALESCE(s.total_amount, 0)
                           - COALESCE((SELECT sum(x.amount) FROM receipt_tx_allocations x WHERE x.receipt_id = s.id), 0), 0),
          'receiptDate', receipt_safe_date(s.receipt_date),
          'supplier',    COALESCE(NULLIF(s.supplier_name_canonical, ''), s.supplier_name_raw),
          'invoice',     s.invoice_number
        ) AS c
        FROM stock_receipts s
        WHERE COALESCE(s.reconciled, false) = false
          AND COALESCE(s.total_amount, 0)
              - COALESCE((SELECT sum(x.amount) FROM receipt_tx_allocations x WHERE x.receipt_id = s.id), 0) > 0
          AND NOT EXISTS (SELECT 1 FROM receipt_tx_allocations a2
                          WHERE a2.receipt_id = s.id AND a2.transaction_id = t.id)
        ORDER BY receipt_safe_date(s.receipt_date) DESC NULLS LAST
        LIMIT 100
      ) q
    ), '[]'::jsonb)
  )
  FROM transactions t
  WHERE t.id = p_tx_id AND t.transfer_type = 'out';
$$;

-- Rải 1 GD ra NHIỀU phiếu 1 lượt. p_items = [{ receiptId, amount? }].
--  - amount rỗng → receipt_alloc_add tự tính = min(còn lại GD, còn nợ phiếu).
--  - GD HẾT tiền (remaining <= 0) → DỪNG êm (phần phiếu còn lại để nguyên), không lỗi cả lô.
--  - amount nhập tay vượt còn-lại GD → tự cắt về đúng phần còn lại (không lỗi).
--  - Validate (tiền ra, không dính hoàn/chi tay) do receipt_alloc_add lo.
--  - Trả summary theo phía GD sau khi rải.
CREATE OR REPLACE FUNCTION tx_receipt_alloc_add_bulk(p_tx_id text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE it jsonb; v_rem numeric; v_amt numeric;
BEGIN
  IF p_tx_id IS NULL THEN RAISE EXCEPTION 'transactionId là bắt buộc'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items phải là mảng';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    CONTINUE WHEN NULLIF(it->>'receiptId', '') IS NULL;
    v_rem := receipt_tx_remaining(p_tx_id);
    EXIT WHEN v_rem <= 0;                       -- GD hết tiền → dừng, để phần còn lại nguyên
    v_amt := NULLIF(it->>'amount', '')::numeric;
    IF v_amt IS NOT NULL AND v_amt > v_rem THEN v_amt := v_rem; END IF;  -- cắt theo còn-lại GD
    PERFORM receipt_alloc_add(jsonb_build_object(
      'receiptId',     it->>'receiptId',
      'transactionId', p_tx_id,
      'amount',        v_amt
    ));
  END LOOP;
  RETURN tx_receipt_alloc_summary(p_tx_id);
END;
$$;

-- Gỡ 1 phân bổ (theo alloc id) → recompute bill → trả summary theo phía GD.
CREATE OR REPLACE FUNCTION tx_receipt_alloc_remove(p_alloc_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_receipt text; v_tx text;
BEGIN
  SELECT receipt_id, transaction_id INTO v_receipt, v_tx
    FROM receipt_tx_allocations WHERE id = p_alloc_id;
  IF v_tx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  DELETE FROM receipt_tx_allocations WHERE id = p_alloc_id;
  PERFORM receipt_alloc_recompute(v_receipt);
  RETURN tx_receipt_alloc_summary(v_tx);
END;
$$;
