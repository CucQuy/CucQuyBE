-- ============================================================
-- Đối soát tiền RA (bank) ↔ chi phí thủ công (manual_expenses).
-- Mỗi tiền ra gắn tối đa 1 khoản chi phí (manual_expenses.transaction_id, migration 035).
-- Đã gắn → tiền ra KHÔNG cộng OPEX auto (khoản chi tay đại diện) → chống đếm trùng.
-- Idempotent (CREATE OR REPLACE). Xem 035_expense_reconcile.sql cho schema.
-- ============================================================

-- Tiền ra "đủ điều kiện đối soát chi phí": out, chưa kết toán, chưa loại, không phải hoàn đơn,
-- CHƯA gắn khoản chi nào.
CREATE OR REPLACE FUNCTION expense_out_reconcilable(t transactions)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT t.transfer_type = 'out'
     AND coalesce(t.settled_out, false) = false
     AND coalesce(t.cost_excluded, false) = false
     AND NOT EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM manual_expenses me WHERE me.transaction_id = t.id);
$$;

-- PREVIEW (dry-run, KHÔNG ghi): gợi ý cặp tiền-ra ↔ chi-phí-tay trùng SỐ TIỀN + gần NGÀY
-- (|ngày| <= p_window_days). Chỉ auto khi 1-1 (GD đúng 1 khoản chi, khoản chi đúng 1 GD).
-- Trả { matched[], skippedAmbiguous, skippedNoMatch, totalUnlinkedTx, totalUnlinkedExpense }.
CREATE OR REPLACE FUNCTION expense_out_reconcile_preview(p_window_days int DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH tx AS (
    SELECT t.id AS tx_id, t.transfer_amount,
           NULLIF(t.transaction_date, '')::timestamptz AS tx_date,
           left(coalesce(NULLIF(t.content,''), t.description, ''), 80) AS descr
    FROM transactions t
    WHERE expense_out_reconcilable(t)
      AND NULLIF(t.transaction_date, '') IS NOT NULL
  ),
  exp AS (
    SELECT m.id AS exp_id, m.amount, m.date, m.category, m.note
    FROM manual_expenses m
    WHERE m.transaction_id IS NULL
  ),
  pairs AS (
    SELECT tx.tx_id, tx.transfer_amount, tx.tx_date, tx.descr,
           exp.exp_id, exp.amount, exp.date AS exp_date, exp.category, exp.note
    FROM tx JOIN exp
      ON exp.amount = tx.transfer_amount
     AND exp.date BETWEEN (tx.tx_date::date - p_window_days) AND (tx.tx_date::date + p_window_days)
  ),
  tx_counts AS (SELECT tx_id, count(*) AS cand FROM pairs GROUP BY tx_id),
  exp_counts AS (SELECT exp_id, count(*) AS claims FROM pairs GROUP BY exp_id),
  clean AS (
    SELECT p.* FROM pairs p
    JOIN tx_counts tc ON tc.tx_id = p.tx_id AND tc.cand = 1
    JOIN exp_counts ec ON ec.exp_id = p.exp_id AND ec.claims = 1
  )
  SELECT jsonb_build_object(
    'matched', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'transactionId', tx_id,
        'expenseId', exp_id,
        'amount', transfer_amount,
        'transactionDate', tx_date,
        'expenseDate', exp_date,
        'category', category,
        'note', note,
        'description', descr
      ) ORDER BY tx_date DESC) FROM clean), '[]'::jsonb),
    'skippedAmbiguous', (SELECT count(*)::int FROM tx
        WHERE EXISTS (SELECT 1 FROM pairs p WHERE p.tx_id = tx.tx_id)
          AND NOT EXISTS (SELECT 1 FROM clean c WHERE c.tx_id = tx.tx_id)),
    'skippedNoMatch', (SELECT count(*)::int FROM tx
        WHERE NOT EXISTS (SELECT 1 FROM pairs p WHERE p.tx_id = tx.tx_id)),
    'totalUnlinkedTx', (SELECT count(*)::int FROM tx),
    'totalUnlinkedExpense', (SELECT count(*)::int FROM exp)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- APPLY: gắn transaction_id cho từng khoản chi theo list cặp đã confirm. Atomic + IDEMPOTENT.
-- p_pairs: jsonb array [{transactionId, expenseId}]. Chỉ ghi khi khoản chi còn chưa gắn VÀ
-- GD đó chưa bị khoản chi khác chiếm (unique index bảo vệ). Trả { applied, skipped }.
CREATE OR REPLACE FUNCTION expense_out_reconcile_apply(p_pairs jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_pair jsonb;
  v_tx_id text;
  v_exp_id uuid;
  v_applied int := 0;
  v_skipped int := 0;
  v_updated int;
BEGIN
  IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN
    RETURN jsonb_build_object('applied', 0, 'skipped', 0);
  END IF;

  FOR v_pair IN SELECT * FROM jsonb_array_elements(p_pairs) LOOP
    v_tx_id := NULLIF(v_pair->>'transactionId', '');
    v_exp_id := NULLIF(v_pair->>'expenseId', '')::uuid;
    IF v_tx_id IS NULL OR v_exp_id IS NULL THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    UPDATE manual_expenses me
       SET transaction_id = v_tx_id
     WHERE me.id = v_exp_id
       AND me.transaction_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM manual_expenses m2 WHERE m2.transaction_id = v_tx_id)
       AND EXISTS (SELECT 1 FROM transactions t WHERE t.id = v_tx_id AND t.transfer_type = 'out');
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 1 THEN v_applied := v_applied + 1;
    ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
END;
$$;

-- LINK tay 1 cặp (GD ↔ khoản chi có sẵn). Trả bản ghi chi phí sau khi gắn (rỗng nếu không gắn được).
CREATE OR REPLACE FUNCTION expense_out_link(p_transaction_id text, p_expense_id uuid)
RETURNS SETOF manual_expenses LANGUAGE sql AS $$
  UPDATE manual_expenses me
     SET transaction_id = p_transaction_id
   WHERE me.id = p_expense_id
     AND me.transaction_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM manual_expenses m2 WHERE m2.transaction_id = p_transaction_id)
     AND EXISTS (SELECT 1 FROM transactions t WHERE t.id = p_transaction_id AND t.transfer_type = 'out')
  RETURNING *;
$$;

-- UNLINK: bỏ gắn khoản chi khỏi 1 GD (tiền ra quay lại tính OPEX auto). Trả số khoản đã bỏ gắn.
CREATE OR REPLACE FUNCTION expense_out_unlink(p_transaction_id text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  UPDATE manual_expenses SET transaction_id = NULL WHERE transaction_id = p_transaction_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
