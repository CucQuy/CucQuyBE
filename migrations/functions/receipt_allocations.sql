-- ============================================================
-- Phân bổ tiền ra ↔ bill (receipt_tx_allocations). Nhiều GD/bill, 1 GD chia nhiều bill.
-- File 'r...' apply TRƯỚC stock_receipt_reconcile.sql ('s...') → hàm remaining sẵn sàng cho nó.
-- ============================================================

-- Parse TEXT ngày → date an toàn (self-contained, không phụ thuộc file khác — tránh vỡ boot
-- trên DB mới do thứ tự apply alphabetical 'r...' trước 's...').
CREATE OR REPLACE FUNCTION receipt_safe_date(p_text text)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_text ~ '^\d{4}-\d{2}-\d{2}' THEN substring(p_text, 1, 10)::date END;
$$;

-- Đã phân bổ bao nhiêu của 1 GD (tổng amount mọi bill).
CREATE OR REPLACE FUNCTION receipt_tx_allocated(p_tx_id text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(amount), 0) FROM receipt_tx_allocations WHERE transaction_id = p_tx_id;
$$;

-- Còn lại chưa phân bổ của 1 GD (transfer_amount - đã phân bổ).
CREATE OR REPLACE FUNCTION receipt_tx_remaining(p_tx_id text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT transfer_amount FROM transactions WHERE id = p_tx_id), 0)
       - receipt_tx_allocated(p_tx_id);
$$;

-- Tính lại cờ reconciled của bill (paid >= total).
CREATE OR REPLACE FUNCTION receipt_alloc_recompute(p_receipt_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_total numeric; v_paid numeric; v_done boolean; v_first text;
BEGIN
  SELECT total_amount INTO v_total FROM stock_receipts WHERE id = p_receipt_id;
  SELECT COALESCE(sum(amount), 0) INTO v_paid FROM receipt_tx_allocations WHERE receipt_id = p_receipt_id;
  v_done := (v_total IS NOT NULL AND v_paid > 0 AND v_paid >= v_total);
  -- transaction_id legacy: trỏ về alloc đầu (hiển thị cũ), NULL nếu không còn alloc.
  SELECT transaction_id INTO v_first FROM receipt_tx_allocations
   WHERE receipt_id = p_receipt_id ORDER BY created_at LIMIT 1;
  UPDATE stock_receipts SET
    reconciled    = v_done,
    reconciled_at = CASE WHEN v_done THEN now() ELSE NULL END,
    transaction_id = v_first
  WHERE id = p_receipt_id;
END;
$$;

-- Tổng hợp phân bổ của 1 bill (cho FE).
CREATE OR REPLACE FUNCTION receipt_alloc_summary(p_receipt_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'receiptId',  s.id,
    'total',      s.total_amount,
    'paid',       COALESCE((SELECT sum(a.amount) FROM receipt_tx_allocations a WHERE a.receipt_id = s.id), 0),
    'remaining',  GREATEST(COALESCE(s.total_amount, 0)
                    - COALESCE((SELECT sum(a.amount) FROM receipt_tx_allocations a WHERE a.receipt_id = s.id), 0), 0),
    'reconciled', COALESCE(s.reconciled, false),
    'allocations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'transactionId', a.transaction_id, 'amount', a.amount,
        'txAmount', t.transfer_amount,
        'transactionDate', receipt_safe_date(t.transaction_date),
        'gateway', t.gateway,
        'content', left(coalesce(NULLIF(t.content,''), t.description, ''), 80)
      ) ORDER BY a.created_at)
      FROM receipt_tx_allocations a JOIN transactions t ON t.id = a.transaction_id
      WHERE a.receipt_id = s.id), '[]'::jsonb)
  )
  FROM stock_receipts s WHERE s.id = p_receipt_id;
$$;

-- Thêm/sửa 1 phân bổ. p_input: { receiptId, transactionId, amount? }.
-- amount rỗng → tự tính = min(còn lại GD, còn thiếu bill). Không vượt còn-lại của GD.
CREATE OR REPLACE FUNCTION receipt_alloc_add(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_receipt   text := NULLIF(p_input->>'receiptId', '');
  v_tx        text := NULLIF(p_input->>'transactionId', '');
  v_amount    numeric := NULLIF(p_input->>'amount', '')::numeric;
  v_tx_amount numeric;
  v_bill_rem  numeric;
  v_pair_cur  numeric;
BEGIN
  IF v_receipt IS NULL OR v_tx IS NULL THEN RAISE EXCEPTION 'receiptId & transactionId là bắt buộc'; END IF;
  SELECT transfer_amount INTO v_tx_amount FROM transactions WHERE id = v_tx AND transfer_type = 'out';
  IF v_tx_amount IS NULL THEN RAISE EXCEPTION 'Giao dịch không hợp lệ (phải là tiền ra)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_receipts WHERE id = v_receipt) THEN RAISE EXCEPTION 'Không tìm thấy bill'; END IF;
  -- Không cho dùng chéo GD đã gắn hoàn tiền / chi phí tay (chống đếm trùng).
  IF EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = v_tx)
     OR EXISTS (SELECT 1 FROM manual_expenses me WHERE me.transaction_id = v_tx) THEN
    RAISE EXCEPTION 'Giao dịch đã gắn hoàn tiền / chi phí khác';
  END IF;

  -- phần đang gắn của chính cặp này (nếu sửa) — được phép giữ lại.
  SELECT COALESCE(amount, 0) INTO v_pair_cur FROM receipt_tx_allocations
   WHERE receipt_id = v_receipt AND transaction_id = v_tx;
  v_pair_cur := COALESCE(v_pair_cur, 0);

  v_bill_rem := GREATEST(
    (SELECT COALESCE(total_amount, 0) FROM stock_receipts WHERE id = v_receipt)
    - (SELECT COALESCE(sum(amount), 0) FROM receipt_tx_allocations WHERE receipt_id = v_receipt) + v_pair_cur,
    0);

  IF v_amount IS NULL OR v_amount <= 0 THEN
    v_amount := LEAST(receipt_tx_remaining(v_tx) + v_pair_cur, NULLIF(v_bill_rem, 0));
    IF v_amount IS NULL OR v_amount <= 0 THEN v_amount := receipt_tx_remaining(v_tx) + v_pair_cur; END IF;
  END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Số tiền phân bổ phải > 0'; END IF;
  IF v_amount > receipt_tx_remaining(v_tx) + v_pair_cur + 0.0001 THEN
    RAISE EXCEPTION 'Vượt số tiền còn lại của giao dịch (còn %)', to_char(receipt_tx_remaining(v_tx) + v_pair_cur, 'FM999999999');
  END IF;

  INSERT INTO receipt_tx_allocations (id, receipt_id, transaction_id, amount)
  VALUES ('rta_' || encode(gen_random_bytes(9), 'hex'), v_receipt, v_tx, v_amount)
  ON CONFLICT (receipt_id, transaction_id) DO UPDATE SET amount = EXCLUDED.amount, created_at = now();

  PERFORM receipt_alloc_recompute(v_receipt);
  RETURN receipt_alloc_summary(v_receipt);
END;
$$;

-- Xoá 1 phân bổ theo id → trả summary bill.
CREATE OR REPLACE FUNCTION receipt_alloc_remove(p_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_receipt text;
BEGIN
  DELETE FROM receipt_tx_allocations WHERE id = p_id RETURNING receipt_id INTO v_receipt;
  IF v_receipt IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  PERFORM receipt_alloc_recompute(v_receipt);
  RETURN receipt_alloc_summary(v_receipt);
END;
$$;

-- Gỡ TẤT CẢ phân bổ của 1 bill (unreconcile).
CREATE OR REPLACE FUNCTION receipt_alloc_clear(p_receipt_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM receipt_tx_allocations WHERE receipt_id = p_receipt_id;
  PERFORM receipt_alloc_recompute(p_receipt_id);
  RETURN receipt_alloc_summary(p_receipt_id);
END;
$$;

-- GD tiền ra CÒN LẠI để gắn cho 1 bill (chưa gắn hết, chưa dính hoàn/chi, chưa gắn vào bill này).
CREATE OR REPLACE FUNCTION receipt_available_out_txns(p_receipt_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'amount', t.transfer_amount,
    'remaining', receipt_tx_remaining(t.id),
    'transactionDate', receipt_safe_date(t.transaction_date),
    'gateway', t.gateway,
    'content', left(coalesce(NULLIF(t.content,''), t.description, ''), 80)
  ) ORDER BY receipt_safe_date(t.transaction_date) DESC NULLS LAST), '[]'::jsonb)
  FROM transactions t
  WHERE t.transfer_type = 'out'
    AND coalesce(t.settled_out, false) = false
    AND coalesce(t.cost_excluded, false) = false
    AND NOT EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM manual_expenses me WHERE me.transaction_id = t.id)
    AND receipt_tx_remaining(t.id) > 0
    AND NOT EXISTS (SELECT 1 FROM receipt_tx_allocations a WHERE a.transaction_id = t.id AND a.receipt_id = p_receipt_id);
$$;
