-- ============================================================
-- Domain: webhooks — SePay + Facebook inbox (idempotent).
-- ============================================================

-- SePay: tạo transaction (idempotent qua transaction_create_from_sepay) + khớp đơn:
--  (1) theo NỘI DUNG (mã ORD-xxx trích từ description) — ưu tiên;
--  (2) fallback theo SỐ TIỀN khi nội dung bị ngân hàng khác ghi đè (không có mã đơn):
--      - đúng 1 đơn khớp → auto-PAID + gắn order_number cho giao dịch;
--      - ≥2 đơn cùng số tiền → KHÔNG auto-PAID, gắn needs_review + review_note để đối soát tay.
-- Khớp được → set order = PAID.
CREATE OR REPLACE FUNCTION webhook_sepay(p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_res jsonb;
  v_tx jsonb;
  v_tx_id text;
  v_order_number text;
  v_transfer_type text;
  v_amount numeric;
  v_tx_date timestamptz;
  v_matched int := 0;
  v_match_by text := NULL;            -- 'content' | 'amount' | NULL
  v_cand_count int := 0;
  v_cand_order_id text;
  v_cand_order_number text;
  v_review_note text := NULL;
BEGIN
  v_res := transaction_create_from_sepay(p_body);
  IF COALESCE((v_res->>'duplicate')::boolean, false) THEN
    RETURN v_res;  -- đã có giao dịch này rồi
  END IF;

  v_tx := v_res->'transaction';
  v_tx_id := v_tx->>'id';
  v_order_number := v_tx->>'order_number';
  v_transfer_type := COALESCE(v_tx->>'transfer_type', 'in');
  v_amount := COALESCE(NULLIF(v_tx->>'transfer_amount', '')::numeric, 0);
  v_tx_date := NULLIF(v_tx->>'transaction_date', '')::timestamptz;

  -- ⚠️ CHỈ auto-PAID khi giao dịch là tiền VÀO (transfer_type='in'). Giao dịch tiền RA
  -- (hoàn tiền/chuyển khoản đi) có thể trích trúng mã ORDxxx trong description → KHÔNG
  -- được đánh dấu đơn là đã thanh toán. (vá latent bug — gate transfer_type)
  IF v_transfer_type = 'in' AND v_order_number IS NOT NULL THEN
    -- (1) Khớp theo NỘI DUNG. Cộng dồn tiền nhận (cọc + trả nốt) → status suy ra.
    UPDATE orders
       SET paid_amount = COALESCE(paid_amount, 0) + v_amount,
           payment_status = order_derive_pay_status(COALESCE(paid_amount, 0) + v_amount, total, payment_status),
           sepay_id = p_body->>'id',
           updated_at = now()
     WHERE order_number = v_order_number;
    GET DIAGNOSTICS v_matched = ROW_COUNT;
    IF v_matched > 0 THEN v_match_by := 'content'; END IF;

  ELSIF v_transfer_type = 'in' AND v_order_number IS NULL
        AND v_amount > 0 AND v_tx_date IS NOT NULL THEN
    -- (2) Fallback khớp theo SỐ TIỀN. Đơn ứng viên = tiêu chí đối soát:
    -- chưa PAID, chưa có sepay_id, GD trong [created_at, +7 ngày], VÀ số tiền khớp
    -- total (trả đủ) HOẶC deposit_amount (đặt cọc — khách chuyển free-text không mã đơn).
    -- (KHÔNG lọc payment_method — khách để CASH nhưng vẫn chuyển khoản; ≥2 đơn trùng → review tay.)
    WITH cand AS (
      SELECT o.id, o.order_number
      FROM orders o
      WHERE o.payment_status IS DISTINCT FROM 'PAID'
        AND o.sepay_id IS NULL
        AND o.order_number IS NOT NULL
        AND o.created_at IS NOT NULL
        AND (o.total = v_amount OR COALESCE(o.deposit_amount, 0) = v_amount)
        AND v_tx_date >= o.created_at
        AND v_tx_date <= o.created_at + interval '7 days'
    )
    SELECT count(*)::int, min(id), min(order_number)
      INTO v_cand_count, v_cand_order_id, v_cand_order_number
      FROM cand;

    IF v_cand_count = 1 THEN
      -- Đúng 1 đơn (khớp đúng total) → cộng dồn + status suy ra + gắn mã đơn cho giao dịch.
      UPDATE orders
         SET paid_amount = COALESCE(paid_amount, 0) + v_amount,
             payment_status = order_derive_pay_status(COALESCE(paid_amount, 0) + v_amount, total, payment_status),
             sepay_id = p_body->>'id',
             updated_at = now()
       WHERE id = v_cand_order_id
         AND sepay_id IS NULL
         AND payment_status IS DISTINCT FROM 'PAID';
      GET DIAGNOSTICS v_matched = ROW_COUNT;
      IF v_matched > 0 THEN
        v_order_number := v_cand_order_number;
        v_match_by := 'amount';
        UPDATE transactions SET order_number = v_cand_order_number WHERE id = v_tx_id;
      END IF;

    ELSIF v_cand_count >= 2 THEN
      -- Nhiều đơn cùng số tiền → KHÔNG auto-PAID, gắn cờ để đối soát thủ công.
      v_review_note := v_cand_count || ' đơn cùng số tiền — cần đối soát thủ công';
      UPDATE transactions
         SET needs_review = true, review_note = v_review_note
       WHERE id = v_tx_id;
    END IF;
  END IF;

  RETURN v_res || jsonb_build_object(
    'orderNumber', v_order_number,
    'orderMatched', v_matched > 0,
    'matchBy', v_match_by,
    'needsReview', v_review_note IS NOT NULL,
    'reviewNote', v_review_note,
    'ambiguousCount', v_cand_count
  );
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
        'name',       COALESCE(NULLIF(oi.product_name, ''), '(?)'),
        'quantity',   COALESCE(oi.quantity, 0),
        'size',       oi.size,
        'sizeCounts', oi.size_counts,
        'flavors',    COALESCE(to_jsonb(oi.flavors), '[]'::jsonb)
      ) ORDER BY oi.id)
      FROM order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM orders o
  WHERE o.order_number = p_order_number
  ORDER BY o.updated_at DESC NULLS LAST
  LIMIT 1;
$$;
