-- Chi phí vận hành: phân loại bank "tiền ra" theo nội dung CK (auto) + set tay (backup).
-- Xem migrations/011_expense_classification.sql cho schema. Idempotent (CREATE OR REPLACE).

-- ── Rule từ khoá (nội dung CK → category) ──
CREATE OR REPLACE FUNCTION expense_rules_list()
RETURNS SETOF expense_rules LANGUAGE sql STABLE AS $$
  SELECT * FROM expense_rules ORDER BY created_at;
$$;

-- Thay toàn bộ danh sách rule (client gửi đủ list). Rỗng → xoá hết.
CREATE OR REPLACE FUNCTION expense_rules_save_all(p_items jsonb)
RETURNS SETOF expense_rules LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM expense_rules;
  INSERT INTO expense_rules (keyword, category)
  SELECT UPPER(TRIM(x->>'keyword')), x->>'category'
  FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) AS x
  WHERE coalesce(TRIM(x->>'keyword'), '') <> '' AND coalesce(x->>'category', '') <> '';
  RETURN QUERY SELECT * FROM expense_rules ORDER BY created_at;
END;
$$;

-- ── Set tay 1 giao dịch: gán category + cờ loại khỏi chi phí (backup khi rule sai) ──
CREATE OR REPLACE FUNCTION transaction_set_expense(
  p_id uuid, p_category text, p_excluded boolean
)
RETURNS SETOF transactions LANGUAGE plpgsql AS $$
BEGIN
  UPDATE transactions
     SET expense_category = NULLIF(p_category, ''),
         cost_excluded    = coalesce(p_excluded, false)
   WHERE id = p_id;
  RETURN QUERY SELECT * FROM transactions WHERE id = p_id;
END;
$$;

-- ── Auto phân loại: out chưa có category, chưa settled/excluded, không refund →
--    khớp nội dung CK với keyword (UPPER contains). Trả số bản ghi đã gán. ──
CREATE OR REPLACE FUNCTION expense_apply_rules()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE transactions t
     SET expense_category = m.category
  FROM (
    SELECT DISTINCT ON (tx.id) tx.id, r.category
    FROM transactions tx
    JOIN expense_rules r
      ON UPPER(coalesce(tx.content,'') || ' ' || coalesce(tx.description,'')) LIKE '%' || r.keyword || '%'
    WHERE tx.transfer_type = 'out'
      AND tx.expense_category IS NULL
      AND coalesce(tx.settled_out,false) = false
      AND coalesce(tx.cost_excluded,false) = false
      AND NOT EXISTS (SELECT 1 FROM order_refunds orf WHERE orf.transaction_id = tx.id)
    ORDER BY tx.id, r.created_at
  ) AS m
  WHERE t.id = m.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Tổng hợp OPEX theo category trong kỳ (cho pie/tổng quan chi phí) ──
--    Gồm: (1) bank "tiền ra" chưa loại + (2) chi phí THỦ CÔNG (đã phân bổ theo tháng).
--    Manual inline (không gọi manual_expense_by_category) để không phụ thuộc thứ tự apply
--    stored function (expense_summary là SQL-lang, validate body lúc tạo).
CREATE OR REPLACE FUNCTION expense_summary(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    jsonb_agg(jsonb_build_object('category', category, 'amount', amount) ORDER BY amount DESC),
    '[]'::jsonb)
  FROM (
    SELECT category, SUM(amount) AS amount
    FROM (
      -- (1) Bank tiền ra (auto)
      SELECT coalesce(NULLIF(t.expense_category, ''), 'unclassified') AS category,
             SUM(t.transfer_amount) AS amount
      FROM transactions t
      WHERE t.transfer_type = 'out'
        AND coalesce(t.settled_out,false) = false
        AND coalesce(t.cost_excluded,false) = false
        AND NOT EXISTS (SELECT 1 FROM order_refunds r WHERE r.transaction_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM manual_expenses me WHERE me.transaction_id = t.id)
        AND revenue_try_ts(t.transaction_date) BETWEEN p_from AND p_to
      GROUP BY coalesce(NULLIF(t.expense_category, ''), 'unclassified')
      UNION ALL
      -- (2) Chi phí thủ công (phân bổ: amount/spread_months mỗi tháng rơi trong kỳ)
      SELECT coalesce(NULLIF(m.category, ''), 'other') AS category,
             SUM(m.amount / m.spread_months) AS amount
      FROM manual_expenses m
      CROSS JOIN LATERAL generate_series(0, m.spread_months - 1) AS i
      WHERE (m.date::timestamptz + (i || ' months')::interval) BETWEEN p_from AND p_to
      GROUP BY coalesce(NULLIF(m.category, ''), 'other')
    ) u
    GROUP BY category
  ) s;
$$;

-- ── List bank-out trong kỳ cho màn "Chi phí vận hành" (kèm phân loại + cờ) ──
CREATE OR REPLACE FUNCTION expense_out_list(p_from timestamptz, p_to timestamptz)
RETURNS SETOF transactions LANGUAGE sql STABLE AS $$
  SELECT *
  FROM transactions t
  WHERE t.transfer_type = 'out'
    AND revenue_try_ts(t.transaction_date) BETWEEN p_from AND p_to
  ORDER BY t.transaction_date DESC;
$$;
