-- ============================================================
-- Domain: stock_receipts (nhập kho) — toàn bộ logic ở DB, BE chỉ gọi.
-- Bảng: stock_receipts (1)-(n) stock_receipt_lines, + suppliers, materials.
-- Khi tạo phiếu: upsert supplier + upsert materials + cập nhật thống kê,
-- tất cả trong 1 transaction (1 lần gọi function = 1 transaction).
-- ============================================================

-- ── Helpers chuẩn hoá (port từ stock-receipts.service.ts / FE normalize) ───

-- Sinh id kiểu Firestore auto-id (20 ký tự alphanumeric).
CREATE OR REPLACE FUNCTION sr_gen_id()
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

-- Bỏ dấu tiếng Việt + lowercase (port stripAccent: NFD + xoá dấu kết hợp).
CREATE OR REPLACE FUNCTION sr_strip_accent(p_in text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text;
BEGIN
  IF p_in IS NULL THEN RETURN ''; END IF;
  v := lower(p_in);
  -- xoá ký tự dấu kết hợp U+0300..U+036F (giống regex /[̀-ͯ]/g sau NFD)
  v := normalize(v, NFD);
  v := regexp_replace(v, '[̀-ͯ]', '', 'g');
  -- đ -> d (NFD không tách đ)
  v := replace(v, 'đ', 'd');
  RETURN v;
END;
$$;

-- normalizeSupplierKey: stripAccent + chỉ giữ [a-z0-9], gộp khoảng trắng.
CREATE OR REPLACE FUNCTION sr_supplier_key(p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text;
BEGIN
  v := sr_strip_accent(trim(COALESCE(p_raw, '')));
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  RETURN trim(v);
END;
$$;

-- canonicalUnit: chuẩn hoá đơn vị về dạng gốc.
CREATE OR REPLACE FUNCTION sr_canonical_unit(p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text;
  v_only text;
  v_map jsonb := '{
    "ki":"kg","kilo":"kg","kilogam":"kg","kg":"kg",
    "gam":"g","gr":"g","g":"g",
    "lit":"l","l":"l",
    "ml":"ml","cl":"cl",
    "thung":"thung","chai":"chai","lon":"lon","goi":"goi",
    "hop":"hop","cai":"cai","cay":"cay","tui":"tui","bich":"tui","qua":"qua"
  }'::jsonb;
BEGIN
  IF p_raw IS NULL THEN RETURN NULL; END IF;
  v := sr_strip_accent(trim(p_raw));
  IF v = '' THEN RETURN NULL; END IF;
  -- bỏ phần số ở đầu (vd "5 kg" -> "kg")
  v_only := trim(regexp_replace(v, '^\d+(?:[.,]\d+)?\s*', ''));
  IF v_map ? v_only THEN RETURN v_map->>v_only; END IF;
  IF v_map ? v THEN RETURN v_map->>v; END IF;
  RETURN NULL;
END;
$$;

-- normalizeItem.fullKey: base (đã bỏ token đơn vị) + "|<num><unit>" nếu có gói.
CREATE OR REPLACE FUNCTION sr_material_key(p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_clean text;
  -- Lưu ý: Postgres regex dùng \y cho word boundary (\b = backspace).
  v_unit_re text := '(\d+(?:[.,]\d+)?)\s*(kg|kilogam|kilo|gam|gr|g|l|lit|ml|cl|goi|hop|chai|thung|lon|cai|cay|tui|bich|qua)\y';
  m text[];
  v_pack text := NULL;
  v_num text;
  v_unit text;
  v_base text;
  v_map jsonb := '{
    "ki":"kg","kilo":"kg","kilogam":"kg","kg":"kg",
    "gam":"g","gr":"g","g":"g",
    "lit":"l","l":"l",
    "ml":"ml","cl":"cl",
    "thung":"thung","chai":"chai","lon":"lon","goi":"goi",
    "hop":"hop","cai":"cai","cay":"cay","tui":"tui","bich":"tui","qua":"qua"
  }'::jsonb;
BEGIN
  v_clean := sr_strip_accent(COALESCE(p_raw, ''));
  m := regexp_match(v_clean, v_unit_re);
  IF m IS NOT NULL THEN
    v_num := replace(m[1], ',', '.');
    v_unit := COALESCE(v_map->>m[2], m[2]);
    v_pack := v_num || v_unit;
  END IF;
  -- base: xoá token đơn vị, chỉ giữ a-z0-9, gộp khoảng trắng
  v_base := regexp_replace(v_clean, v_unit_re, ' ', 'g');
  v_base := regexp_replace(v_base, '[^a-z0-9]+', ' ', 'g');
  v_base := regexp_replace(v_base, '\s+', ' ', 'g');
  v_base := trim(v_base);
  IF v_pack IS NULL THEN
    RETURN v_base;
  END IF;
  RETURN v_base || '|' || v_pack;
END;
$$;

-- computeBillHash: sha256 hex của supplierKey||receiptDate||totalAmount||ocr(4000).
CREATE OR REPLACE FUNCTION sr_bill_hash(
  p_supplier_key text, p_receipt_date text, p_total text, p_ocr text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(
    digest(
      concat_ws('||',
        COALESCE(p_supplier_key, ''),
        COALESCE(p_receipt_date, ''),
        COALESCE(p_total, ''),
        left(trim(COALESCE(p_ocr, '')), 4000)
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- ── READ ───────────────────────────────────────────────────────────────────

-- Danh sách NCC đã nhập (mới cập nhật trước).
CREATE OR REPLACE FUNCTION stock_receipt_supplier_list()
RETURNS SETOF suppliers
LANGUAGE sql STABLE AS $$
  SELECT * FROM suppliers ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST;
$$;

-- Danh sách nguyên liệu đã nhập (mới cập nhật trước).
CREATE OR REPLACE FUNCTION stock_receipt_material_list()
RETURNS SETOF materials
LANGUAGE sql STABLE AS $$
  SELECT * FROM materials ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST;
$$;

-- Danh sách phiếu nhập (summary) — mới tạo trước.
-- TICKET 5: KHÔNG trả receipt_image_base64 trong list (ảnh nặng) — chỉ trả ở
-- detail (stock_receipt_get). FE list summary không dùng ảnh.
-- Trả TABLE để loại cột ảnh nhưng vẫn đủ field cho mapSummary.
-- ⚠️ RETURNS TABLE đổi (thêm reconciled, transaction_id) -> đổi return type,
-- CREATE OR REPLACE sẽ lỗi "cannot change return type". Auto-migrate re-apply file
-- này lúc deploy nên phải DROP trước.
DROP FUNCTION IF EXISTS stock_receipt_list();
CREATE OR REPLACE FUNCTION stock_receipt_list()
RETURNS TABLE (
  id text,
  supplier_id text,
  supplier_name_raw text,
  supplier_name_canonical text,
  store_or_branch text,
  invoice_number text,
  receipt_date text,
  total_amount numeric,
  currency text,
  product_line_count int,
  status text,
  source text,
  reconciled boolean,
  transaction_id text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    id, supplier_id, supplier_name_raw, supplier_name_canonical,
    store_or_branch, invoice_number, receipt_date, total_amount, currency,
    product_line_count, status, source,
    COALESCE(reconciled, false) AS reconciled, transaction_id,
    created_at, updated_at
  FROM stock_receipts
  ORDER BY created_at DESC NULLS LAST;
$$;

-- Chi tiết 1 phiếu nhập kèm lines -> jsonb (NULL nếu không tồn tại).
CREATE OR REPLACE FUNCTION stock_receipt_get(p_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_h stock_receipts%ROWTYPE;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_h FROM stock_receipts WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'name', l.name,
             'quantity', l.quantity,
             'unit', l.unit,
             'unitPrice', l.unit_price,
             'lineTotal', l.line_total
           ) ORDER BY l.created_at ASC NULLS LAST
         ), '[]'::jsonb)
  INTO v_lines
  FROM stock_receipt_lines l
  WHERE l.receipt_id = p_id;

  RETURN jsonb_build_object('header', to_jsonb(v_h), 'lines', v_lines);
END;
$$;

-- ── WRITE đơn giản ───────────────────────────────────────────────────────────

-- Cập nhật thông tin NCC. Field có trong p_patch mới được set (partial update):
-- name/phone/address/contactPerson/email/taxCode/category/channel/notes.
-- p_patch: jsonb camelCase. Chuỗi rỗng -> NULL (trừ name: rỗng thì BỎ QUA, giữ tên cũ).
CREATE OR REPLACE FUNCTION stock_receipt_supplier_update(p_id text, p_patch jsonb)
RETURNS SETOF suppliers
LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
BEGIN
  -- name: chỉ set nếu gửi lên & không rỗng (đồng thời cập nhật normalized_name)
  IF p_patch ? 'name' THEN
    v_name := trim(COALESCE(p_patch->>'name', ''));
    IF v_name <> '' THEN
      UPDATE suppliers
      SET name = v_name,
          normalized_name = sr_supplier_key(v_name)
      WHERE id = p_id;
    END IF;
  END IF;

  IF p_patch ? 'phone' THEN
    UPDATE suppliers SET phone = NULLIF(trim(COALESCE(p_patch->>'phone','')), '') WHERE id = p_id;
  END IF;
  IF p_patch ? 'address' THEN
    UPDATE suppliers SET address = NULLIF(trim(COALESCE(p_patch->>'address','')), '') WHERE id = p_id;
  END IF;
  IF p_patch ? 'contactPerson' THEN
    UPDATE suppliers SET contact_person = NULLIF(trim(COALESCE(p_patch->>'contactPerson','')), '') WHERE id = p_id;
  END IF;
  IF p_patch ? 'email' THEN
    UPDATE suppliers SET email = NULLIF(trim(COALESCE(p_patch->>'email','')), '') WHERE id = p_id;
  END IF;
  IF p_patch ? 'taxCode' THEN
    UPDATE suppliers SET tax_code = NULLIF(trim(COALESCE(p_patch->>'taxCode','')), '') WHERE id = p_id;
  END IF;
  IF p_patch ? 'category' THEN
    UPDATE suppliers SET category = NULLIF(trim(COALESCE(p_patch->>'category','')), '') WHERE id = p_id;
  END IF;
  IF p_patch ? 'channel' THEN
    UPDATE suppliers SET channel = NULLIF(trim(COALESCE(p_patch->>'channel','')), '') WHERE id = p_id;
  END IF;
  IF p_patch ? 'notes' THEN
    UPDATE suppliers SET notes = NULLIF(trim(COALESCE(p_patch->>'notes','')), '') WHERE id = p_id;
  END IF;

  UPDATE suppliers SET updated_at = now() WHERE id = p_id;

  RETURN QUERY SELECT * FROM suppliers WHERE id = p_id;
END;
$$;

-- ── WRITE phức tạp: tạo phiếu nhập (1 transaction) ──────────────────────────
-- p_input: jsonb camelCase, gồm:
--   structured {supplierName,supplierPhone,supplierAddress,invoiceNumber,storeOrBranch,
--               receiptDate,receiptTime,lineItems[],productLineCount,subtotal,tax,discount,
--               totalAmount,currency,paymentMethod,notes}
--   validation {isLikelyReceipt,confidence,reasonVi,heuristicScore,heuristicNoteVi}
--   ocrText, receiptImageBase64, receiptImageMimeType,
--   targetSupplierId, supplierContact {phone,address,...}, createdByUid
-- Trả về jsonb { id } khi tạo mới, hoặc RAISE EXCEPTION 'DUPLICATE_BILL:<id>' nếu trùng billHash.
CREATE OR REPLACE FUNCTION stock_receipt_create(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_struct jsonb := COALESCE(p_input->'structured', '{}'::jsonb);
  v_valid  jsonb := COALESCE(p_input->'validation', '{}'::jsonb);
  v_contact jsonb := COALESCE(p_input->'supplierContact', '{}'::jsonb);
  v_target_supplier text := NULLIF(p_input->>'targetSupplierId', '');
  v_created_by text := NULLIF(p_input->>'createdByUid', '');
  v_ocr text := COALESCE(p_input->>'ocrText', '');
  -- nguồn phiếu: 'ocr' (mặc định) | 'manual'. Phiếu manual bỏ qua chống trùng billHash.
  v_source text := COALESCE(NULLIF(p_input->>'source', ''), 'ocr');

  v_supplier_name_raw text := NULLIF(v_struct->>'supplierName', '');
  v_supplier_id text;
  v_supplier_name text;
  v_supplier_key text;
  v_supplier_is_new boolean := false;

  -- Tổng phiếu (cho thống kê supplier.total_amount). Nếu FE gửi totalAmount đã
  -- chốt -> GIỮ NGUYÊN; null -> fallback = tổng line (gán sau khi tính v_sum_lines).
  v_total_input numeric := NULLIF(v_struct->>'totalAmount','')::numeric;
  v_total numeric := COALESCE(v_total_input, 0);
  v_bill_hash text;
  v_dup_id text;

  v_contact_phone text;
  v_contact_address text;
  v_contact_person text;
  v_contact_email text;
  v_contact_tax_code text;
  v_contact_category text;
  v_contact_channel text;
  v_contact_notes text;

  v_receipt_date text := NULLIF(v_struct->>'receiptDate', '');
  v_now timestamptz := now();
  v_now_iso text := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  v_header_id text := sr_gen_id();
  v_line_count int := 0;

  v_sum_lines numeric := 0;
  v_delta_pct numeric := 0;
  v_warn boolean := false;

  v_line jsonb;
  v_lname text;
  v_lkey text;
  v_lunit text;
  v_lunit_canon text;
  v_lqty numeric;
  v_lamount numeric;
  v_lunitprice numeric;
  v_mat_id text;
  v_mat_is_new boolean;
BEGIN
  -- ── resolveSupplier ──────────────────────────────────────────────────────
  -- 1) targetSupplierId tồn tại -> dùng lại
  IF v_target_supplier IS NOT NULL THEN
    SELECT id, name, COALESCE(NULLIF(normalized_name,''), sr_supplier_key(name))
      INTO v_supplier_id, v_supplier_name, v_supplier_key
    FROM suppliers WHERE id = v_target_supplier;
    IF FOUND THEN
      v_supplier_is_new := false;
    END IF;
  END IF;

  -- 2) chưa có -> tìm theo normalized_name; nếu không có thì sẽ tạo mới
  IF v_supplier_id IS NULL AND v_supplier_name_raw IS NOT NULL THEN
    v_supplier_name := trim(v_supplier_name_raw);
    v_supplier_key := sr_supplier_key(v_supplier_name);
    IF v_supplier_key <> '' THEN
      SELECT id INTO v_supplier_id FROM suppliers WHERE normalized_name = v_supplier_key LIMIT 1;
      IF v_supplier_id IS NULL THEN
        v_supplier_id := sr_gen_id();
        v_supplier_is_new := true;
      END IF;
    ELSE
      v_supplier_name := NULL; -- key rỗng -> không có supplier
    END IF;
  END IF;
  v_supplier_key := COALESCE(v_supplier_key, '');

  -- ── computeBillHash + chống trùng ────────────────────────────────────────
  -- Vẫn tính & lưu bill_hash cho mọi phiếu (truy vết), nhưng CHỈ chặn trùng với
  -- phiếu OCR. Phiếu manual (ocrText rỗng) dễ ra hash trùng oan khi cùng
  -- NCC + ngày + tổng tiền — thực tế là 2 phiếu hợp lệ khác nhau.
  v_bill_hash := sr_bill_hash(
    v_supplier_key,
    v_receipt_date,
    CASE WHEN (v_struct->>'totalAmount') IS NULL THEN '' ELSE (v_struct->>'totalAmount') END,
    v_ocr
  );
  IF v_source = 'ocr' THEN
    SELECT id INTO v_dup_id FROM stock_receipts WHERE bill_hash = v_bill_hash LIMIT 1;
    IF v_dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'DUPLICATE_BILL:%', v_dup_id;
    END IF;
  END IF;

  -- contact (đầy đủ field — bảng suppliers đã có cột từ migration 011)
  v_contact_phone    := NULLIF(trim(COALESCE(v_contact->>'phone','')), '');
  v_contact_address  := NULLIF(trim(COALESCE(v_contact->>'address','')), '');
  v_contact_person   := NULLIF(trim(COALESCE(v_contact->>'contactPerson','')), '');
  v_contact_email    := NULLIF(trim(COALESCE(v_contact->>'email','')), '');
  v_contact_tax_code := NULLIF(trim(COALESCE(v_contact->>'taxCode','')), '');
  v_contact_category := NULLIF(trim(COALESCE(v_contact->>'category','')), '');
  v_contact_channel  := NULLIF(trim(COALESCE(v_contact->>'channel','')), '');
  v_contact_notes    := NULLIF(trim(COALESCE(v_contact->>'notes','')), '');

  -- tổng các dòng (dùng cho amountCheck + fallback total khi FE không gửi total)
  SELECT COALESCE(SUM(COALESCE(NULLIF(li->>'lineTotal','')::numeric, 0)), 0)
    INTO v_sum_lines
  FROM jsonb_array_elements(COALESCE(v_struct->'lineItems', '[]'::jsonb)) AS li
  WHERE trim(COALESCE(li->>'name','')) <> '';

  -- TICKET 4: tổng phiếu đã chốt -> giữ nguyên; null -> fallback tổng line.
  -- (KHÔNG ép tính lại khi FE đã gửi total.)
  v_total := COALESCE(v_total_input, v_sum_lines);

  -- ── upsert supplier + thống kê ───────────────────────────────────────────
  IF v_supplier_id IS NOT NULL AND v_supplier_name IS NOT NULL THEN
    IF v_supplier_is_new THEN
      INSERT INTO suppliers (
        id, name, normalized_name, receipt_count, total_amount, last_receipt_date,
        phone, address, contact_person, email, tax_code, category, channel, notes,
        created_at, updated_at
      ) VALUES (
        v_supplier_id, v_supplier_name, v_supplier_key, 1, v_total, v_now,
        v_contact_phone, v_contact_address, v_contact_person, v_contact_email,
        v_contact_tax_code, v_contact_category, v_contact_channel, v_contact_notes, v_now, v_now
      );
    ELSE
      UPDATE suppliers SET
        receipt_count = COALESCE(receipt_count, 0) + 1,
        total_amount = COALESCE(total_amount, 0) + v_total,
        last_receipt_date = v_now,
        phone = COALESCE(v_contact_phone, phone),
        address = COALESCE(v_contact_address, address),
        contact_person = COALESCE(v_contact_person, contact_person),
        email = COALESCE(v_contact_email, email),
        tax_code = COALESCE(v_contact_tax_code, tax_code),
        category = COALESCE(v_contact_category, category),
        channel = COALESCE(v_contact_channel, channel),
        notes = COALESCE(v_contact_notes, notes),
        updated_at = v_now
      WHERE id = v_supplier_id;
    END IF;
  ELSE
    v_supplier_id := NULL; -- không có supplier hợp lệ
  END IF;

  -- ── amountCheck (computeAmountCheck) ─────────────────────────────────────
  IF v_total_input IS NOT NULL AND v_total_input > 0 THEN
    v_delta_pct := abs(v_sum_lines - v_total_input) / v_total_input;
  ELSE
    v_delta_pct := 0;
  END IF;
  v_warn := v_delta_pct > 0.02;

  -- số dòng hợp lệ (cho productLineCount fallback)
  SELECT count(*) INTO v_line_count
  FROM jsonb_array_elements(COALESCE(v_struct->'lineItems', '[]'::jsonb)) AS li
  WHERE trim(COALESCE(li->>'name','')) <> '';

  -- ── insert header ────────────────────────────────────────────────────────
  INSERT INTO stock_receipts (
    id, supplier_id, supplier_name_raw, supplier_name_canonical, store_or_branch,
    invoice_number, supplier_phone, supplier_address, receipt_date, receipt_time,
    subtotal, tax, discount, total_amount, currency, payment_method, notes,
    product_line_count, ocr_text, receipt_image_base64, receipt_image_mime_type,
    validation_is_likely_receipt, validation_confidence, validation_reason_vi,
    validation_heuristic_score, validation_heuristic_note_vi,
    amount_check_sum_lines, amount_check_delta_pct, amount_check_warn,
    bill_hash, status, source, created_by_uid, created_at, updated_at
  ) VALUES (
    v_header_id,
    v_supplier_id,
    v_supplier_name_raw,
    v_supplier_name,
    NULLIF(v_struct->>'storeOrBranch',''),
    NULLIF(v_struct->>'invoiceNumber',''),
    NULLIF(v_struct->>'supplierPhone',''),
    NULLIF(v_struct->>'supplierAddress',''),
    v_receipt_date,
    NULLIF(v_struct->>'receiptTime',''),
    NULLIF(v_struct->>'subtotal','')::numeric,
    NULLIF(v_struct->>'tax','')::numeric,
    NULLIF(v_struct->>'discount','')::numeric,
    NULLIF(v_struct->>'totalAmount','')::numeric,
    COALESCE(NULLIF(v_struct->>'currency',''), 'VND'),
    NULLIF(v_struct->>'paymentMethod',''),
    NULLIF(v_struct->>'notes',''),
    COALESCE(NULLIF(v_struct->>'productLineCount','')::int, v_line_count),
    v_ocr,
    NULLIF(p_input->>'receiptImageBase64',''),
    NULLIF(p_input->>'receiptImageMimeType',''),
    COALESCE((v_valid->>'isLikelyReceipt')::boolean, false),
    COALESCE(NULLIF(v_valid->>'confidence','')::numeric, 0),
    COALESCE(v_valid->>'reasonVi', ''),
    COALESCE(NULLIF(v_valid->>'heuristicScore','')::numeric, 0),
    COALESCE(v_valid->>'heuristicNoteVi', ''),
    v_sum_lines,
    v_delta_pct,
    v_warn,
    v_bill_hash,
    'committed',
    v_source,
    v_created_by,
    v_now,
    v_now
  );

  -- ── lines + upsert materials + thống kê ──────────────────────────────────
  FOR v_line IN
    SELECT li FROM jsonb_array_elements(COALESCE(v_struct->'lineItems', '[]'::jsonb)) AS li
  LOOP
    v_lname := trim(COALESCE(v_line->>'name', ''));
    CONTINUE WHEN v_lname = '';
    v_lkey := sr_material_key(v_lname);
    CONTINUE WHEN v_lkey = '';

    v_lunit := NULLIF(trim(COALESCE(v_line->>'unit','')), '');
    v_lunit_canon := sr_canonical_unit(v_lunit);
    v_lqty := COALESCE(NULLIF(v_line->>'quantity','')::numeric, 0);
    v_lamount := COALESCE(NULLIF(v_line->>'lineTotal','')::numeric, 0);
    -- unitPrice: ưu tiên gửi lên; nếu thiếu, tính amount/qty khi cả hai > 0
    IF (v_line->>'unitPrice') IS NOT NULL AND (v_line->>'unitPrice') <> '' THEN
      v_lunitprice := (v_line->>'unitPrice')::numeric;
    ELSIF v_lqty > 0 AND v_lamount > 0 THEN
      v_lunitprice := v_lamount / v_lqty;
    ELSE
      v_lunitprice := NULL;
    END IF;

    -- resolveMaterial: tìm theo normalized_name, không có thì tạo mới
    SELECT id INTO v_mat_id FROM materials WHERE normalized_name = v_lkey LIMIT 1;
    IF v_mat_id IS NULL THEN
      v_mat_id := sr_gen_id();
      v_mat_is_new := true;
    ELSE
      v_mat_is_new := false;
    END IF;

    IF v_mat_is_new THEN
      INSERT INTO materials (
        id, name, normalized_name, canonical_unit, import_count, total_qty, total_amount,
        last_unit_price, last_supplier_id, last_supplier_name, last_receipt_date,
        created_at, updated_at
      ) VALUES (
        v_mat_id, v_lname, v_lkey, v_lunit_canon, 1, v_lqty, v_lamount,
        v_lunitprice, v_supplier_id, v_supplier_name, v_now, v_now, v_now
      );
    ELSE
      UPDATE materials SET
        import_count = COALESCE(import_count, 0) + 1,
        total_qty = COALESCE(total_qty, 0) + v_lqty,
        total_amount = COALESCE(total_amount, 0) + v_lamount,
        last_unit_price = v_lunitprice,
        last_supplier_id = v_supplier_id,
        last_supplier_name = v_supplier_name,
        last_receipt_date = v_now,
        updated_at = v_now
      WHERE id = v_mat_id;
    END IF;

    INSERT INTO stock_receipt_lines (
      id, receipt_id, material_id, material_name_raw, name, quantity, unit,
      unit_price, line_total, supplier_id, receipt_date, created_at
    ) VALUES (
      sr_gen_id(), v_header_id, v_mat_id, v_lname, v_lname,
      NULLIF(v_line->>'quantity','')::numeric,
      v_lunit,
      v_lunitprice,
      NULLIF(v_line->>'lineTotal','')::numeric,
      v_supplier_id, v_receipt_date, v_now
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_header_id);
END;
$$;

-- ── MERGE NCC ────────────────────────────────────────────────────────────────
-- Gộp các NCC trùng (p_dup_ids) vào root: chuyển receipt/material trỏ về root,
-- cộng dồn thống kê, xoá NCC trùng. Tất cả 1 transaction.
CREATE OR REPLACE FUNCTION stock_receipt_merge_suppliers(p_root_id text, p_dup_ids jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_root_name text;
  v_dups text[];
  v_count_sum int := 0;
  v_amount_sum numeric := 0;
BEGIN
  SELECT name INTO v_root_name FROM suppliers WHERE id = p_root_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Root supplier không tồn tại'; END IF;
  v_root_name := COALESCE(v_root_name, '');

  -- danh sách dup hợp lệ (khác root, tồn tại)
  SELECT array_agg(DISTINCT d) INTO v_dups
  FROM jsonb_array_elements_text(COALESCE(p_dup_ids, '[]'::jsonb)) AS d
  WHERE d <> '' AND d <> p_root_id AND EXISTS (SELECT 1 FROM suppliers s WHERE s.id = d);
  IF v_dups IS NULL OR array_length(v_dups, 1) IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(COALESCE(receipt_count,0)),0), COALESCE(SUM(COALESCE(total_amount,0)),0)
    INTO v_count_sum, v_amount_sum
  FROM suppliers WHERE id = ANY(v_dups);

  UPDATE stock_receipts
  SET supplier_id = p_root_id, supplier_name_canonical = v_root_name, updated_at = now()
  WHERE supplier_id = ANY(v_dups);

  UPDATE materials
  SET last_supplier_id = p_root_id, last_supplier_name = v_root_name, updated_at = now()
  WHERE last_supplier_id = ANY(v_dups);

  -- Cộng dồn thống kê vào root + giữ field liên hệ của root; chỉ lấp từ dup
  -- (theo updated_at mới nhất) khi field root đang NULL — tránh mất data khi gộp.
  UPDATE suppliers r
  SET receipt_count = COALESCE(r.receipt_count,0) + v_count_sum,
      total_amount = COALESCE(r.total_amount,0) + v_amount_sum,
      phone          = COALESCE(r.phone,          d.phone),
      address        = COALESCE(r.address,        d.address),
      contact_person = COALESCE(r.contact_person, d.contact_person),
      email          = COALESCE(r.email,          d.email),
      tax_code       = COALESCE(r.tax_code,       d.tax_code),
      category       = COALESCE(r.category,       d.category),
      channel        = COALESCE(r.channel,        d.channel),
      notes          = COALESCE(r.notes,          d.notes),
      updated_at = now()
  FROM (
    SELECT DISTINCT ON (1) true AS k,
           phone, address, contact_person, email, tax_code, category, channel, notes
    FROM suppliers
    WHERE id = ANY(v_dups)
    ORDER BY 1, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  ) d
  WHERE r.id = p_root_id;

  DELETE FROM suppliers WHERE id = ANY(v_dups);
END;
$$;

-- ── RECOMPUTE aggregate NVL từ nguồn thật (stock_receipt_lines) ──────────────
-- Tính lại import_count/total_qty/total_amount/canonical_unit từ các dòng phiếu.
-- canonical_unit = đơn vị xuất hiện nhiều nhất trong dòng. p_id NULL = tất cả.
CREATE OR REPLACE FUNCTION material_recompute(p_id text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  UPDATE materials m SET
    import_count = a.cnt,
    total_qty    = a.qty,
    total_amount = a.amount,
    canonical_unit = COALESCE(a.top_unit, m.canonical_unit),
    updated_at   = now()
  FROM (
    SELECT l.material_id,
           count(*) AS cnt,
           sum(COALESCE(l.quantity,0)) AS qty,
           sum(COALESCE(l.line_total,0)) AS amount,
           (SELECT NULLIF(trim(l2.unit),'')
              FROM stock_receipt_lines l2
             WHERE l2.material_id = l.material_id AND NULLIF(trim(l2.unit),'') IS NOT NULL
             GROUP BY NULLIF(trim(l2.unit),'')
             ORDER BY count(*) DESC, 1 LIMIT 1) AS top_unit
    FROM stock_receipt_lines l
    GROUP BY l.material_id
  ) a
  WHERE m.id = a.material_id AND (p_id IS NULL OR m.id = p_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Dry-run: trả các material lệch aggregate HOẶC có đơn vị lẫn (không ghi gì).
CREATE OR REPLACE FUNCTION material_recompute_preview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id, 'name', m.name,
    'curQty', m.total_qty, 'newQty', a.qty,
    'curAmount', m.total_amount, 'newAmount', a.amount,
    'curCount', COALESCE(m.import_count,0), 'newCount', a.cnt,
    'curUnit', m.canonical_unit, 'unitKinds', a.unit_kinds
  ) ORDER BY a.unit_kinds DESC, m.name)
    FILTER (WHERE m.total_qty IS DISTINCT FROM a.qty
                OR m.total_amount IS DISTINCT FROM a.amount
                OR COALESCE(m.import_count,0) <> a.cnt
                OR a.unit_kinds > 1), '[]'::jsonb)
  FROM materials m
  JOIN (
    SELECT material_id, count(*) cnt, sum(COALESCE(quantity,0)) qty,
           sum(COALESCE(line_total,0)) amount,
           count(DISTINCT NULLIF(trim(unit),'')) unit_kinds
    FROM stock_receipt_lines GROUP BY material_id
  ) a ON a.material_id = m.id;
$$;

-- ── MERGE nguyên liệu ────────────────────────────────────────────────────────
-- Gộp các nguyên liệu trùng vào root: lines trỏ về root, cộng dồn thống kê, xoá dup.
CREATE OR REPLACE FUNCTION stock_receipt_merge_materials(p_root_id text, p_dup_ids jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_root_name text;
  v_dups text[];
BEGIN
  SELECT name INTO v_root_name FROM materials WHERE id = p_root_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Root material không tồn tại'; END IF;
  v_root_name := COALESCE(v_root_name, '');

  SELECT array_agg(DISTINCT d) INTO v_dups
  FROM jsonb_array_elements_text(COALESCE(p_dup_ids, '[]'::jsonb)) AS d
  WHERE d <> '' AND d <> p_root_id AND EXISTS (SELECT 1 FROM materials m WHERE m.id = d);
  IF v_dups IS NULL OR array_length(v_dups, 1) IS NULL THEN RETURN; END IF;

  -- Dồn dòng phiếu của dup về root, xoá dup, rồi TÍNH LẠI aggregate root từ
  -- toàn bộ dòng (gồm dòng vừa gộp) → chính xác tuyệt đối, không cộng counter (drift).
  UPDATE stock_receipt_lines
  SET material_id = p_root_id, material_name_raw = v_root_name
  WHERE material_id = ANY(v_dups);

  DELETE FROM materials WHERE id = ANY(v_dups);

  PERFORM material_recompute(p_root_id);
END;
$$;

-- ── GỢI Ý GỘP nguyên liệu trùng (Phase 1) ────────────────────────────────────
-- So sánh từng cặp material (a.id < b.id) bằng similarity của phần BASE
-- (split_part(normalized_name,'|',1) — bỏ phần pack "|<num><unit>") dùng pg_trgm.
-- Chỉ giữ cặp similarity >= p_threshold. Trả jsonb ARRAY camelCase (FE dùng thẳng),
-- sắp xếp similarity DESC.
-- ⚠️ Chỉ chạy được SAU khi migration 013 (CREATE EXTENSION pg_trgm) đã apply.
CREATE OR REPLACE FUNCTION stock_receipt_material_merge_suggestions(
  p_threshold real DEFAULT 0.4
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      id, name, import_count, total_qty, canonical_unit,
      split_part(COALESCE(normalized_name, ''), '|', 1) AS base_name
    FROM materials
    WHERE COALESCE(split_part(COALESCE(normalized_name, ''), '|', 1), '') <> ''
  ),
  pairs AS (
    SELECT
      similarity(a.base_name, b.base_name) AS sim,
      a.id AS a_id, a.name AS a_name, a.import_count AS a_import,
      a.total_qty AS a_qty, a.canonical_unit AS a_unit,
      b.id AS b_id, b.name AS b_name, b.import_count AS b_import,
      b.total_qty AS b_qty, b.canonical_unit AS b_unit
    FROM base a
    JOIN base b ON a.id < b.id
    WHERE similarity(a.base_name, b.base_name) >= p_threshold
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'similarity', sim,
      'a', jsonb_build_object(
        'id', a_id, 'name', a_name, 'importCount', COALESCE(a_import, 0),
        'totalQty', COALESCE(a_qty, 0), 'canonicalUnit', a_unit
      ),
      'b', jsonb_build_object(
        'id', b_id, 'name', b_name, 'importCount', COALESCE(b_import, 0),
        'totalQty', COALESCE(b_qty, 0), 'canonicalUnit', b_unit
      )
    ) ORDER BY sim DESC
  ), '[]'::jsonb)
  FROM pairs;
$$;

-- ── Sửa NVL (vá gap "NVL không sửa được") ────────────────────────────────────
-- Partial update qua jsonb patch (style stock_receipt_supplier_update).
-- Cho phép set name / canonicalUnit. Đổi name -> cập nhật normalized_name =
-- sr_material_key(name). Chỉ update key có trong patch. Luôn set updated_at.
CREATE OR REPLACE FUNCTION stock_receipt_material_update(p_id text, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
BEGIN
  -- name: chỉ set khi gửi lên & không rỗng (đồng thời cập nhật normalized_name)
  IF p_patch ? 'name' THEN
    v_name := trim(COALESCE(p_patch->>'name', ''));
    IF v_name <> '' THEN
      UPDATE materials
      SET name = v_name,
          normalized_name = sr_material_key(v_name)
      WHERE id = p_id;
    END IF;
  END IF;

  IF p_patch ? 'canonicalUnit' THEN
    UPDATE materials
    SET canonical_unit = NULLIF(trim(COALESCE(p_patch->>'canonicalUnit', '')), '')
    WHERE id = p_id;
  END IF;

  UPDATE materials SET updated_at = now() WHERE id = p_id;
END;
$$;

-- ============================================================
-- Đối soát phiếu nhập kho ↔ giao dịch SePay tiền ra (009).
-- ============================================================

-- Danh sách phiếu nhập + field đối soát — phục vụ tab "Tiền ra" (FE) gắn 1 GD
-- out ↔ 1 phiếu nhập. transactionId != NULL => đã gắn GD đó.
CREATE OR REPLACE FUNCTION stock_receipt_list_for_reconcile()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'receiptId',      sr.id,
    'supplierName',   COALESCE(NULLIF(sr.supplier_name_canonical,''), NULLIF(sr.supplier_name_raw,'')),
    'totalAmount',    sr.total_amount,
    'receiptDate',    sr.receipt_date,
    'invoiceNumber',  sr.invoice_number,
    'transactionId',  sr.transaction_id,
    'reconciled',     COALESCE(sr.reconciled, false)
  ) ORDER BY sr.created_at DESC NULLS LAST), '[]'::jsonb)
  FROM stock_receipts sr;
$$;

-- Gắn 1 GD tiền ra cho 1 phiếu nhập. Trả { ok, receiptId, transactionId }.
CREATE OR REPLACE FUNCTION stock_receipt_reconcile(
  p_receipt_id     text,
  p_transaction_id text,
  p_user           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_tx_type   text;
  v_tx_amount numeric;
  v_total     numeric;
  v_used      text;
  v_actor     text := refund_actor_name(p_user);  -- tái dùng helper (orders.sql)
BEGIN
  SELECT total_amount INTO v_total FROM stock_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT transfer_type, transfer_amount INTO v_tx_type, v_tx_amount
  FROM transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSACTION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF COALESCE(v_tx_type,'') <> 'out' THEN
    RAISE EXCEPTION 'TRANSACTION_NOT_OUTGOING' USING ERRCODE = 'check_violation';
  END IF;

  -- GD đã gắn cho phiếu nhập KHÁC?
  SELECT id INTO v_used FROM stock_receipts
  WHERE transaction_id = p_transaction_id AND id <> p_receipt_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'TRANSACTION_ALREADY_LINKED' USING ERRCODE = 'unique_violation';
  END IF;
  -- GD đã gắn cho 1 phiếu HOÀN TIỀN? (không cho dùng chéo)
  SELECT id INTO v_used FROM order_refunds WHERE transaction_id = p_transaction_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'TRANSACTION_ALREADY_LINKED' USING ERRCODE = 'unique_violation';
  END IF;

  IF v_tx_amount IS NOT NULL AND COALESCE(v_total,0) <> v_tx_amount THEN
    RAISE WARNING 'Tổng phiếu nhập (%) lệch số tiền giao dịch (%) — vẫn cho đối soát',
      v_total, v_tx_amount;
  END IF;

  UPDATE stock_receipts SET
    transaction_id = p_transaction_id,
    reconciled     = true,
    reconciled_at  = now(),
    reconciled_by  = v_actor
  WHERE id = p_receipt_id;

  RETURN jsonb_build_object('ok', true, 'receiptId', p_receipt_id, 'transactionId', p_transaction_id);
END;
$$;

-- Gỡ đối soát phiếu nhập (về chưa đối soát).
CREATE OR REPLACE FUNCTION stock_receipt_unreconcile(p_receipt_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM stock_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE stock_receipts SET
    transaction_id = NULL,
    reconciled     = false,
    reconciled_at  = NULL,
    reconciled_by  = NULL
  WHERE id = p_receipt_id;
  RETURN jsonb_build_object('ok', true, 'receiptId', p_receipt_id);
END;
$$;
