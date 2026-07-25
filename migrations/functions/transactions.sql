-- ============================================================
-- Domain: transactions — toàn bộ logic ở DB, BE chỉ gọi.
-- ============================================================

-- Sinh id kiểu Firestore auto-id (20 ký tự alphanumeric) cho transaction mới.
CREATE OR REPLACE FUNCTION transaction_gen_id()
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_id text := '';
  i int;
BEGIN
  FOR i IN 1..20 LOOP
    v_id := v_id || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  END LOOP;
  RETURN v_id;
END;
$$;

-- Liệt kê giao dịch (sắp theo ngày giao dịch giảm dần).
CREATE OR REPLACE FUNCTION transaction_list()
RETURNS SETOF transactions
LANGUAGE sql STABLE AS $$
  SELECT * FROM transactions ORDER BY transaction_date DESC NULLS LAST, created_at DESC NULLS LAST;
$$;

-- Giao dịch theo mã đơn (đối soát).
CREATE OR REPLACE FUNCTION transaction_list_by_order(p_order_number text)
RETURNS SETOF transactions
LANGUAGE sql STABLE AS $$
  SELECT * FROM transactions
  WHERE order_number = p_order_number
  ORDER BY transaction_date DESC NULLS LAST, created_at DESC NULLS LAST;
$$;

-- Giao dịch tiền RA (transfer_type='out') CHƯA gắn phiếu hoàn nào (008/#186).
-- Dùng cho FE chọn giao dịch khi đối soát phiếu hoàn. Loại GD đã đánh dấu external.
CREATE OR REPLACE FUNCTION transaction_list_out_unlinked()
RETURNS SETOF transactions
LANGUAGE sql STABLE AS $$
  SELECT t.* FROM transactions t
  WHERE t.transfer_type = 'out'
    AND COALESCE(t.is_external, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM order_refunds r WHERE r.transaction_id = t.id
    )
  ORDER BY t.transaction_date DESC NULLS LAST, t.created_at DESC NULLS LAST;
$$;

-- Đánh dấu / bỏ đánh dấu giao dịch ngoài hệ thống. Trả về dòng đã cập nhật.
CREATE OR REPLACE FUNCTION transaction_mark_external(p_id text, p_is_external boolean)
RETURNS SETOF transactions
LANGUAGE sql AS $$
  UPDATE transactions SET is_external = p_is_external WHERE id = p_id RETURNING *;
$$;

-- Đánh dấu / bỏ đánh dấu giao dịch tiền RA đã "kết toán" (chuyển về TK chính) — 010.
CREATE OR REPLACE FUNCTION transaction_mark_settled(p_id text, p_settled boolean)
RETURNS SETOF transactions
LANGUAGE sql AS $$
  UPDATE transactions SET settled_out = p_settled WHERE id = p_id RETURNING *;
$$;

-- Liên kết / gỡ liên kết giao dịch với 1 đơn (order_number rỗng = gỡ -> NULL).
-- Trả về dòng đã cập nhật.
CREATE OR REPLACE FUNCTION transaction_link_order(p_id text, p_order_number text)
RETURNS SETOF transactions
LANGUAGE sql AS $$
  UPDATE transactions
  SET order_number = NULLIF(p_order_number, ''),
      needs_review = false,   -- admin đã xử lý → gỡ cờ đối soát
      review_note  = NULL
  WHERE id = p_id
  RETURNING *;
$$;

-- Tạo giao dịch từ webhook SePay, IDEMPOTENT theo sepay_id.
-- p_body: jsonb client gửi (camelCase) — đọc các field như SePay payload.
-- Logic chống trùng: nếu đã tồn tại transaction cùng sepay_id -> KHÔNG insert,
-- trả về { duplicate: true, transaction: <dòng cũ> }.
-- Ngược lại insert mới, trả về { duplicate: false, transaction: <dòng mới> }.
-- order_number được trích ORD<digits> -> ORD-<digits> từ description (nếu có).
CREATE OR REPLACE FUNCTION transaction_create_from_sepay(p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_sepay_id bigint;
  v_order_number text;
  v_match text;
  v_now timestamptz := now();
  v_existing transactions%ROWTYPE;
  v_new transactions%ROWTYPE;
BEGIN
  v_sepay_id := NULLIF(p_body->>'id', '')::bigint;
  IF v_sepay_id IS NULL THEN
    RAISE EXCEPTION 'sepay id is required';
  END IF;

  -- Chống trùng: SePay có thể gửi lặp / queue retry -> không tạo 2 lần.
  SELECT * INTO v_existing FROM transactions WHERE sepay_id = v_sepay_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'transaction', to_jsonb(v_existing)
    );
  END IF;

  -- Trích mã đơn ORD<digits> -> ORD-<digits> từ description.
  v_match := substring(COALESCE(p_body->>'description', '') FROM 'ORD\d+');
  v_order_number := CASE WHEN v_match IS NULL THEN NULL
                         ELSE regexp_replace(v_match, '^ORD(\d+)$', 'ORD-\1') END;

  INSERT INTO transactions (
    id, sepay_id, gateway, transaction_date, account_number, code, content,
    transfer_type, transfer_amount, accumulated, sub_account, reference_code,
    description, order_number, is_external, received_at, created_at
  ) VALUES (
    transaction_gen_id(),
    v_sepay_id,
    COALESCE(p_body->>'gateway', ''),
    COALESCE(p_body->>'transactionDate', ''),
    COALESCE(p_body->>'accountNumber', ''),
    NULLIF(p_body->>'code', ''),
    COALESCE(p_body->>'content', ''),
    COALESCE(NULLIF(p_body->>'transferType', ''), 'in'),
    COALESCE(NULLIF(p_body->>'transferAmount', '')::numeric, 0),
    COALESCE(NULLIF(p_body->>'accumulated', '')::numeric, 0),
    NULLIF(p_body->>'subAccount', ''),
    COALESCE(p_body->>'referenceCode', ''),
    COALESCE(p_body->>'description', ''),
    v_order_number,
    false,
    v_now,
    v_now
  )
  RETURNING * INTO v_new;

  RETURN jsonb_build_object(
    'duplicate', false,
    'transaction', to_jsonb(v_new)
  );
END;
$$;

-- ============================================================
-- Đối soát hàng loạt (nút "Đồng bộ với đơn").
-- Tiêu chí 1 đơn ứng viên: số tiền = total (trả đủ) HOẶC = deposit_amount (đặt cọc),
-- chưa PAID, chưa có sepay_id, GD xảy ra SAU khi tạo đơn và trong vòng 7 ngày.
-- Chỉ auto-khớp khi GD có ĐÚNG 1 ứng viên VÀ đơn đó chỉ được 1 GD nhắm tới (không tranh chấp).
-- ============================================================

-- PREVIEW (dry-run, KHÔNG ghi): trả { matched[], skippedAmbiguous, skippedNoMatch, totalUnmatched }.
CREATE OR REPLACE FUNCTION transaction_reconcile_preview()
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH unmatched AS (
    SELECT id AS tx_id, sepay_id, transfer_amount,
           NULLIF(transaction_date, '')::timestamptz AS tx_date
    FROM transactions
    WHERE transfer_type = 'in'
      AND order_number IS NULL
      AND COALESCE(is_external, false) = false
      AND NULLIF(transaction_date, '') IS NOT NULL
  ),
  pairs AS (
    SELECT u.tx_id, u.sepay_id, u.transfer_amount, u.tx_date,
           o.id AS order_id, o.order_number, o.created_at
    FROM unmatched u
    JOIN orders o
      ON o.payment_status IS DISTINCT FROM 'PAID'
     AND o.sepay_id IS NULL
     AND o.order_number IS NOT NULL
     AND o.created_at IS NOT NULL
     AND (o.total = u.transfer_amount OR COALESCE(o.deposit_amount, 0) = u.transfer_amount)
     AND u.tx_date >= o.created_at
     AND u.tx_date <= o.created_at + interval '7 days'
  ),
  tx_counts AS (SELECT tx_id, count(*) AS cand FROM pairs GROUP BY tx_id),
  order_counts AS (SELECT order_id, count(*) AS claims FROM pairs GROUP BY order_id),
  clean AS (
    SELECT p.* FROM pairs p
    JOIN tx_counts tc ON tc.tx_id = p.tx_id AND tc.cand = 1
    JOIN order_counts oc ON oc.order_id = p.order_id AND oc.claims = 1
  )
  SELECT jsonb_build_object(
    'matched', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'transactionId', tx_id,
        'sepayId', sepay_id,
        'orderId', order_id,
        'orderNumber', order_number,
        'amount', transfer_amount,
        'transactionDate', tx_date,
        'orderCreatedAt', created_at
      ) ORDER BY tx_date) FROM clean), '[]'::jsonb),
    'skippedAmbiguous', (SELECT count(*)::int FROM unmatched u
        WHERE EXISTS (SELECT 1 FROM pairs p WHERE p.tx_id = u.tx_id)
          AND NOT EXISTS (SELECT 1 FROM clean c WHERE c.tx_id = u.tx_id)),
    'skippedNoMatch', (SELECT count(*)::int FROM unmatched u
        WHERE NOT EXISTS (SELECT 1 FROM pairs p WHERE p.tx_id = u.tx_id)),
    'totalUnmatched', (SELECT count(*)::int FROM unmatched)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- APPLY: ghi map cho danh sách cặp đã confirm. Atomic (1 function = 1 transaction), IDEMPOTENT.
-- p_pairs: jsonb array [{transactionId, orderId, orderNumber, sepayId}].
-- Chỉ ghi khi GD vẫn chưa map (order_number NULL) VÀ đơn vẫn eligible (chưa PAID, chưa sepay_id)
-- → GD và đơn luôn đồng bộ (cùng ghi hoặc cùng bỏ qua). Trả { applied, skipped }.
CREATE OR REPLACE FUNCTION transaction_reconcile_apply(p_pairs jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_pair jsonb;
  v_tx_id text;
  v_order_id text;
  v_order_number text;
  v_sepay_id text;
  v_amount numeric;
  v_applied int := 0;
  v_skipped int := 0;
  v_ord_updated int;
BEGIN
  IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN
    RETURN jsonb_build_object('applied', 0, 'skipped', 0);
  END IF;

  FOR v_pair IN SELECT * FROM jsonb_array_elements(p_pairs) LOOP
    v_tx_id := v_pair->>'transactionId';
    v_order_id := v_pair->>'orderId';
    v_order_number := v_pair->>'orderNumber';
    v_sepay_id := NULLIF(v_pair->>'sepayId', '');
    v_amount := 0;

    -- GD phải còn chưa map. Lấy luôn số tiền từ DB (không tin amount client).
    SELECT transfer_amount INTO v_amount
      FROM transactions WHERE id = v_tx_id AND order_number IS NULL;
    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Claim đơn: chỉ khi còn eligible (idempotent + không cướp link đơn đã PAID/đã có sepay).
    -- Cộng dồn paid_amount + suy ra status → cọc (< total) thành DEPOSITED, trả đủ thành PAID.
    UPDATE orders
      SET sepay_id = v_sepay_id,
          paid_amount = COALESCE(paid_amount, 0) + COALESCE(v_amount, 0),
          payment_status = order_derive_pay_status(COALESCE(paid_amount, 0) + COALESCE(v_amount, 0), total, payment_status),
          updated_at = now()
      WHERE id = v_order_id
        AND sepay_id IS NULL
        AND payment_status IS DISTINCT FROM 'PAID';
    GET DIAGNOSTICS v_ord_updated = ROW_COUNT;

    IF v_ord_updated = 1 THEN
      UPDATE transactions
        SET order_number = v_order_number, needs_review = false, review_note = NULL
        WHERE id = v_tx_id;
      v_applied := v_applied + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
END;
$$;
