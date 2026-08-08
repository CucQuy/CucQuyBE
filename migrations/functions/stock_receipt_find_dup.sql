-- ============================================================
-- Kiểm tra 1 bill (đang up) đã có trong hệ thống chưa — TRƯỚC khi lưu.
-- Tính bill_hash y HỆT stock_receipt_create (cùng biểu thức v_struct) để khớp tuyệt đối.
-- Trả { duplicate, receipt? } (receipt = phiếu đã có nếu trùng).
-- ============================================================
CREATE OR REPLACE FUNCTION stock_receipt_find_duplicate(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_struct jsonb := p_input->'structured';
  v_ocr text := COALESCE(p_input->>'ocrText', '');
  v_target text := NULLIF(p_input->>'targetSupplierId', '');
  v_supplier_name text := NULLIF(trim(v_struct->>'supplierName'), '');
  v_supplier_key text;
  v_receipt_date text := NULLIF(v_struct->>'receiptDate', '');
  v_hash text;
  v_row stock_receipts%ROWTYPE;
BEGIN
  -- supplier_key: giống create — ưu tiên normalized_name của targetSupplierId, else sr_supplier_key(name).
  IF v_target IS NOT NULL THEN
    SELECT COALESCE(NULLIF(normalized_name, ''), sr_supplier_key(name))
      INTO v_supplier_key FROM suppliers WHERE id = v_target;
  END IF;
  IF v_supplier_key IS NULL THEN
    v_supplier_key := sr_supplier_key(COALESCE(v_supplier_name, ''));
  END IF;
  v_supplier_key := COALESCE(v_supplier_key, '');

  v_hash := sr_bill_hash(
    v_supplier_key,
    v_receipt_date,
    CASE WHEN (v_struct->>'totalAmount') IS NULL THEN '' ELSE (v_struct->>'totalAmount') END,
    v_ocr
  );

  SELECT * INTO v_row FROM stock_receipts WHERE bill_hash = v_hash LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('duplicate', false);
  END IF;
  RETURN jsonb_build_object('duplicate', true, 'receipt', jsonb_build_object(
    'id', v_row.id,
    'supplierName', COALESCE(NULLIF(v_row.supplier_name_canonical, ''), v_row.supplier_name_raw),
    'receiptDate', v_row.receipt_date,
    'totalAmount', v_row.total_amount,
    'createdAt', v_row.created_at
  ));
END;
$$;
