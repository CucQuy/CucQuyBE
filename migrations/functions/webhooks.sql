-- ============================================================
-- Domain: webhooks — SePay + Facebook inbox (idempotent).
-- ============================================================

-- SePay: tạo transaction (idempotent qua transaction_create_from_sepay) +
-- nếu khớp orderNumber → set order = PAID.
CREATE OR REPLACE FUNCTION webhook_sepay(p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_res jsonb;
  v_order_number text;
  v_matched int := 0;
BEGIN
  v_res := transaction_create_from_sepay(p_body);
  IF COALESCE((v_res->>'duplicate')::boolean, false) THEN
    RETURN v_res;  -- đã có giao dịch này rồi
  END IF;

  v_order_number := v_res->'transaction'->>'order_number';
  -- ⚠️ CHỈ auto-PAID khi giao dịch là tiền VÀO (transfer_type='in'). Giao dịch tiền RA
  -- (hoàn tiền/chuyển khoản đi) có thể trích trúng mã ORDxxx trong description → KHÔNG
  -- được đánh dấu đơn là đã thanh toán. (vá latent bug — gate transfer_type)
  IF v_order_number IS NOT NULL
     AND COALESCE(v_res->'transaction'->>'transfer_type', 'in') = 'in' THEN
    UPDATE orders
       SET payment_status = 'PAID',
           sepay_id = p_body->>'id',
           updated_at = now()
     WHERE order_number = v_order_number;
    GET DIAGNOSTICS v_matched = ROW_COUNT;
  END IF;

  RETURN v_res || jsonb_build_object('orderNumber', v_order_number, 'orderMatched', v_matched > 0);
END;
$$;

-- Tóm tắt đơn cho noti Zalo khi auto-PAID: tên khách + SĐT + danh sách món (name × qty).
-- Read-only; tách khỏi webhook_sepay để không đổi luồng ghi. Lấy đơn khớp order_number
-- mới cập nhật nhất (phòng trùng số đơn hiếm gặp).
CREATE OR REPLACE FUNCTION order_paid_noti_summary(p_order_number text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'customerName', COALESCE(o.customer_name, ''),
    'phone',        COALESCE(o.phone, ''),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name',     COALESCE(NULLIF(oi.product_name, ''), '(?)'),
        'quantity', COALESCE(oi.quantity, 0)
      ) ORDER BY oi.id)
      FROM order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM orders o
  WHERE o.order_number = p_order_number
  ORDER BY o.updated_at DESC NULLS LAST
  LIMIT 1;
$$;

-- Facebook/Fanpage inbox: lưu message + attachments, idempotent theo id_new_message.
CREATE OR REPLACE FUNCTION facebook_message_create(p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_idnew text := NULLIF(trim(p_body->>'id_new_message'), '');
  v_existing text;
  v_id text;
  v_att jsonb;
BEGIN
  IF v_idnew IS NULL THEN
    RAISE EXCEPTION 'id_new_message is required';
  END IF;

  SELECT id INTO v_existing FROM facebook_messages WHERE id_new_message = v_idnew LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', true, 'id', v_existing);
  END IF;

  v_id := 'fb_' || encode(gen_random_bytes(9), 'hex');
  INSERT INTO facebook_messages (
    id, id_new_message, id_page, page_scope_id, id_conversion, id_cong_ty, message, type,
    is_phone, use_webhook, url_webhook, app_id, page_name, customer_name, number_phone,
    country_code, sent_by_shop, ai_disabled, content_type, source_created_at, received_at, created_at
  ) VALUES (
    v_id, v_idnew,
    p_body->>'id_page', p_body->>'page_scopeid', p_body->>'id_conversion',
    COALESCE(NULLIF(p_body->>'idcongty','')::bigint, 0),
    COALESCE(p_body->>'message',''),
    COALESCE(NULLIF(p_body->>'type','')::int, 0),
    COALESCE(NULLIF(p_body->>'is_phone','')::int, 0),
    COALESCE(NULLIF(p_body->>'use_webhook','')::int, 0),
    p_body->>'url_webhook', NULLIF(p_body->>'app_id',''),
    p_body->>'page_name', p_body->>'customer_name', p_body->>'number_phone', p_body->>'country_code',
    COALESCE(NULLIF(p_body->>'sent_by_shop','')::int, 0),
    COALESCE((p_body->>'ai_disabled')::boolean, false),
    COALESCE(p_body->'content'->>'type', ''),
    NULLIF(trim(p_body->>'create_at'), ''),
    now(), now()
  );

  FOR v_att IN SELECT * FROM jsonb_array_elements(COALESCE(p_body->'attachment', '[]'::jsonb)) LOOP
    INSERT INTO facebook_message_attachments (message_id, type, url)
    VALUES (v_id, v_att->>'type', v_att->>'url');
  END LOOP;

  RETURN jsonb_build_object('duplicate', false, 'id', v_id);
END;
$$;
