-- ============================================================
-- Thanh toán VẬN CHUYỂN (ship): gắn GD tiền RA ↔ ĐƠN / NHÀ XE (carrier). Nhái order_refunds.
-- Schema: migration 080_shipping_payments.sql (bảng shipping_payments, uniq theo transaction_id).
--
-- Gắn ship → set transactions.expense_category='shipping' để P&L đếm ĐÚNG 1 LẦN (shipping là
-- chi phí cost). Status ledger riêng 'shipping' (đặt TRƯỚC nhánh 'expense' trong
-- transaction_ledger_status nên không hiện 'expense').
--
-- Đọc-thuần cho summary/reconcilable (STABLE); create/unlink có ghi. Idempotent (CREATE OR REPLACE).
-- Áp dụng ở thứ tự 's...' (sau carriers 'c', orders 'o', receipt_allocations 'r') → hàm/bảng phụ thuộc đã sẵn.
-- ============================================================

-- Tiền ra "đủ điều kiện gắn ship": out, chưa kết toán, CHƯA gắn hoàn/chi phí tay/phiếu nhập/ship khác.
CREATE OR REPLACE FUNCTION shipping_out_reconcilable(t transactions)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT t.transfer_type = 'out'
     AND coalesce(t.settled_out, false) = false
     AND NOT EXISTS (SELECT 1 FROM order_refunds r        WHERE r.transaction_id  = t.id)
     AND NOT EXISTS (SELECT 1 FROM manual_expenses me     WHERE me.transaction_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM receipt_tx_allocations a WHERE a.transaction_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM shipping_payments sp    WHERE sp.transaction_id = t.id);
$$;

-- Tổng hợp ship theo phía GIAO DỊCH: link hiện tại (nếu có) để hiển thị / gỡ ở modal đối soát.
CREATE OR REPLACE FUNCTION shipping_payment_summary(p_tx_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'transactionId', t.id,
    'txAmount',      t.transfer_amount,
    'payment', (
      SELECT jsonb_build_object(
        'id',          sp.id,
        'amount',      sp.amount,
        'note',        sp.note,
        'orderId',     sp.order_id,
        'orderNumber', o.order_number,
        'customer',    o.customer_name,
        'carrierId',   sp.carrier_id,
        'carrierName', c.name
      )
      FROM shipping_payments sp
      LEFT JOIN orders   o ON o.id = sp.order_id
      LEFT JOIN carriers c ON c.id = sp.carrier_id
      WHERE sp.transaction_id = t.id
      LIMIT 1
    )
  )
  FROM transactions t
  WHERE t.id = p_tx_id AND t.transfer_type = 'out';
$$;

-- Gắn ship cho 1 GD tiền ra. p_input = { transactionId, orderId?, carrierId?, amount?, note?, user? }.
-- Guard: GD phải tiền ra, chưa gắn hoàn/chi phí/phiếu nhập; cần ít nhất đơn hoặc nhà xe;
-- amount mặc định = cả GD, không vượt số tiền GD. ON CONFLICT → đổi mục tiêu (idempotent).
CREATE OR REPLACE FUNCTION shipping_payment_create(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_tx        text    := NULLIF(p_input->>'transactionId', '');
  v_order     text    := NULLIF(p_input->>'orderId', '');
  v_carrier   text    := NULLIF(p_input->>'carrierId', '');
  v_amount    numeric := NULLIF(p_input->>'amount', '')::numeric;
  v_note      text    := NULLIF(p_input->>'note', '');
  v_by        text    := NULLIF(p_input->>'user', '');
  v_tx_amount numeric;
BEGIN
  IF v_tx IS NULL THEN RAISE EXCEPTION 'transactionId là bắt buộc'; END IF;
  IF v_order IS NULL AND v_carrier IS NULL THEN
    RAISE EXCEPTION 'Cần chọn đơn hoặc nhà xe cho khoản ship';
  END IF;

  SELECT transfer_amount INTO v_tx_amount FROM transactions WHERE id = v_tx AND transfer_type = 'out';
  IF v_tx_amount IS NULL THEN RAISE EXCEPTION 'Giao dịch không hợp lệ (phải là tiền ra)'; END IF;

  IF EXISTS (SELECT 1 FROM order_refunds r         WHERE r.transaction_id  = v_tx)
     OR EXISTS (SELECT 1 FROM manual_expenses me    WHERE me.transaction_id = v_tx)
     OR EXISTS (SELECT 1 FROM receipt_tx_allocations a WHERE a.transaction_id = v_tx) THEN
    RAISE EXCEPTION 'Giao dịch đã gắn hoàn tiền / chi phí / phiếu nhập khác';
  END IF;

  IF v_order IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE id = v_order) THEN
    RAISE EXCEPTION 'Không tìm thấy đơn';
  END IF;
  IF v_carrier IS NOT NULL AND NOT EXISTS (SELECT 1 FROM carriers WHERE id = v_carrier) THEN
    RAISE EXCEPTION 'Không tìm thấy nhà xe';
  END IF;

  v_amount := COALESCE(v_amount, v_tx_amount);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Số tiền ship phải > 0'; END IF;
  IF v_amount > v_tx_amount + 0.0001 THEN
    RAISE EXCEPTION 'Số tiền ship vượt số tiền giao dịch';
  END IF;

  INSERT INTO shipping_payments (transaction_id, order_id, carrier_id, amount, note, created_by)
  VALUES (v_tx, v_order, v_carrier, v_amount, v_note, v_by)
  ON CONFLICT (transaction_id) DO UPDATE
    SET order_id   = EXCLUDED.order_id,
        carrier_id = EXCLUDED.carrier_id,
        amount     = EXCLUDED.amount,
        note       = EXCLUDED.note,
        created_at = now();

  -- Ship là chi phí → gắn category 'shipping' để OPEX đếm 1 lần; bỏ cờ loại-khỏi-chi-phí.
  UPDATE transactions SET expense_category = 'shipping', cost_excluded = false WHERE id = v_tx;

  RETURN shipping_payment_summary(v_tx);
END;
$$;

-- Gỡ ship khỏi 1 GD (trả về "chưa khớp"). Xoá luôn category 'shipping' đã tự đặt.
CREATE OR REPLACE FUNCTION shipping_payment_unlink(p_tx_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  DELETE FROM shipping_payments WHERE transaction_id = p_tx_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    UPDATE transactions SET expense_category = NULL
     WHERE id = p_tx_id AND expense_category = 'shipping';
  END IF;
  RETURN jsonb_build_object('unlinked', v_n);
END;
$$;
