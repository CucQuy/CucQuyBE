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

-- Đánh dấu / bỏ đánh dấu giao dịch ngoài hệ thống. Trả về dòng đã cập nhật.
CREATE OR REPLACE FUNCTION transaction_mark_external(p_id text, p_is_external boolean)
RETURNS SETOF transactions
LANGUAGE sql AS $$
  UPDATE transactions SET is_external = p_is_external WHERE id = p_id RETURNING *;
$$;

-- Liên kết / gỡ liên kết giao dịch với 1 đơn (order_number rỗng = gỡ -> NULL).
-- Trả về dòng đã cập nhật.
CREATE OR REPLACE FUNCTION transaction_link_order(p_id text, p_order_number text)
RETURNS SETOF transactions
LANGUAGE sql AS $$
  UPDATE transactions
  SET order_number = NULLIF(p_order_number, '')
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
