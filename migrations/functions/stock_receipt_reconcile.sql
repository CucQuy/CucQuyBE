-- ============================================================
-- Đối soát tiền RA (bank) ↔ PHIẾU NHẬP (stock_receipts). Nhái expense_reconcile.sql.
-- Mỗi tiền ra gắn tối đa 1 phiếu (stock_receipts.transaction_id, migration 009).
-- Idempotent (CREATE OR REPLACE). Ngày lưu TEXT → parse an toàn bằng guard regex.
-- ============================================================

-- Tiền ra "đủ điều kiện đối soát phiếu nhập": out, chưa kết toán, chưa loại chi phí,
-- KHÔNG phải hoàn đơn, CHƯA gắn phiếu nào, CHƯA gắn khoản chi tay nào (chống đếm trùng).
CREATE OR REPLACE FUNCTION stock_receipt_out_reconcilable(t transactions)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT t.transfer_type = 'out'
     AND coalesce(t.settled_out, false) = false
     AND coalesce(t.cost_excluded, false) = false
     AND NOT EXISTS (SELECT 1 FROM stock_receipts s WHERE s.transaction_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM manual_expenses me WHERE me.transaction_id = t.id);
$$;

-- Parse TEXT ngày → date an toàn (NULL nếu không phải yyyy-mm-dd...). Dùng nội bộ.
CREATE OR REPLACE FUNCTION stock_receipt_safe_date(p_text text)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_text ~ '^\d{4}-\d{2}-\d{2}' THEN substring(p_text, 1, 10)::date END;
$$;

-- PREVIEW (dry-run, KHÔNG ghi): gợi ý cặp tiền-ra ↔ phiếu-nhập trùng SỐ TIỀN (total_amount)
-- + gần NGÀY (|ngày| <= p_window_days). Chỉ auto khi 1-1 (GD đúng 1 phiếu, phiếu đúng 1 GD).
-- Trả { matched[], skippedAmbiguous, skippedNoMatch, totalUnlinkedTx, totalUnlinkedReceipt }.
CREATE OR REPLACE FUNCTION stock_receipt_reconcile_preview(p_window_days int DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH tx AS (
    SELECT t.id AS tx_id, t.transfer_amount, t.gateway,
           stock_receipt_safe_date(t.transaction_date) AS tx_date,
           left(coalesce(NULLIF(t.content,''), t.description, ''), 80) AS descr
    FROM transactions t
    WHERE stock_receipt_out_reconcilable(t)
      AND stock_receipt_safe_date(t.transaction_date) IS NOT NULL
  ),
  sr AS (
    SELECT s.id AS receipt_id, s.total_amount,
           stock_receipt_safe_date(s.receipt_date) AS rc_date,
           coalesce(NULLIF(s.supplier_name_canonical,''), s.supplier_name_raw, '?') AS supplier,
           s.invoice_number
    FROM stock_receipts s
    WHERE coalesce(s.reconciled, false) = false AND s.transaction_id IS NULL
      AND s.total_amount IS NOT NULL
  ),
  pairs AS (
    SELECT tx.tx_id, tx.transfer_amount, tx.tx_date, tx.descr, tx.gateway,
           sr.receipt_id, sr.total_amount, sr.rc_date, sr.supplier, sr.invoice_number
    FROM tx JOIN sr
      ON sr.total_amount = tx.transfer_amount
     AND sr.rc_date IS NOT NULL
     AND sr.rc_date BETWEEN (tx.tx_date - p_window_days) AND (tx.tx_date + p_window_days)
  ),
  tx_counts AS (SELECT tx_id, count(*) AS cand FROM pairs GROUP BY tx_id),
  rc_counts AS (SELECT receipt_id, count(*) AS claims FROM pairs GROUP BY receipt_id),
  clean AS (
    SELECT p.* FROM pairs p
    JOIN tx_counts tc ON tc.tx_id = p.tx_id AND tc.cand = 1
    JOIN rc_counts rc ON rc.receipt_id = p.receipt_id AND rc.claims = 1
  )
  SELECT jsonb_build_object(
    'matched', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'transactionId', tx_id,
        'receiptId', receipt_id,
        'amount', transfer_amount,
        'transactionDate', tx_date,
        'receiptDate', rc_date,
        'gateway', gateway,
        'supplier', supplier,
        'invoiceNumber', invoice_number,
        'description', descr
      ) ORDER BY tx_date DESC) FROM clean), '[]'::jsonb),
    'skippedAmbiguous', (SELECT count(*)::int FROM tx
        WHERE EXISTS (SELECT 1 FROM pairs p WHERE p.tx_id = tx.tx_id)
          AND NOT EXISTS (SELECT 1 FROM clean c WHERE c.tx_id = tx.tx_id)),
    'skippedNoMatch', (SELECT count(*)::int FROM tx
        WHERE NOT EXISTS (SELECT 1 FROM pairs p WHERE p.tx_id = tx.tx_id)),
    'totalUnlinkedTx', (SELECT count(*)::int FROM tx),
    'totalUnlinkedReceipt', (SELECT count(*)::int FROM sr)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- APPLY: gắn transaction_id cho từng phiếu theo list cặp đã confirm. Atomic + IDEMPOTENT.
-- p_pairs: jsonb array [{receiptId, transactionId}]. Chỉ ghi khi phiếu còn chưa đối soát VÀ
-- GD chưa bị phiếu khác chiếm VÀ GD là tiền ra. Trả { applied, skipped }.
CREATE OR REPLACE FUNCTION stock_receipt_reconcile_apply(p_pairs jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_pair jsonb;
  v_receipt_id text;
  v_tx_id text;
  v_applied int := 0;
  v_skipped int := 0;
  v_updated int;
BEGIN
  IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN
    RETURN jsonb_build_object('applied', 0, 'skipped', 0);
  END IF;

  FOR v_pair IN SELECT * FROM jsonb_array_elements(p_pairs) LOOP
    v_receipt_id := NULLIF(v_pair->>'receiptId', '');
    v_tx_id := NULLIF(v_pair->>'transactionId', '');
    IF v_receipt_id IS NULL OR v_tx_id IS NULL THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    UPDATE stock_receipts sr
       SET transaction_id = v_tx_id,
           reconciled = true,
           reconciled_at = now(),
           reconciled_by = 'Đối soát tự động'
     WHERE sr.id = v_receipt_id
       AND sr.transaction_id IS NULL
       AND coalesce(sr.reconciled, false) = false
       AND NOT EXISTS (SELECT 1 FROM stock_receipts s2 WHERE s2.transaction_id = v_tx_id)
       AND NOT EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = v_tx_id)
       AND EXISTS (SELECT 1 FROM transactions t WHERE t.id = v_tx_id AND t.transfer_type = 'out');
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 1 THEN v_applied := v_applied + 1;
    ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
END;
$$;

-- Danh sách GD tiền RA đủ điều kiện nhưng CHƯA gắn phiếu (cho màn "khớp tay" chọn thủ công).
-- FE tự lọc/sắp theo độ gần tiền + ngày với phiếu đang chọn.
CREATE OR REPLACE FUNCTION stock_receipt_unlinked_out_txns()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id', t.id,
      'amount', t.transfer_amount,
      'transactionDate', stock_receipt_safe_date(t.transaction_date),
      'gateway', t.gateway,
      'content', left(coalesce(NULLIF(t.content,''), t.description, ''), 80)
    ) ORDER BY stock_receipt_safe_date(t.transaction_date) DESC NULLS LAST),
    '[]'::jsonb)
  FROM transactions t
  WHERE stock_receipt_out_reconcilable(t);
$$;
