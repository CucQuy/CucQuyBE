-- Chi phí thủ công (CRUD + phân bổ). Idempotent (CREATE OR REPLACE).
-- Xem migrations/027_manual_expenses.sql cho schema + ngữ nghĩa phân bổ.

CREATE OR REPLACE FUNCTION manual_expense_list()
RETURNS SETOF manual_expenses LANGUAGE sql STABLE AS $$
  SELECT * FROM manual_expenses ORDER BY date DESC, created_at DESC;
$$;

-- Tạo/sửa 1 khoản (có id → update; không → insert). Trả bản ghi.
CREATE OR REPLACE FUNCTION manual_expense_upsert(p jsonb)
RETURNS SETOF manual_expenses LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  v_id := NULLIF(p->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO manual_expenses (date, amount, category, spread_months, note)
    VALUES (
      coalesce((p->>'date')::date, current_date),
      greatest(coalesce((p->>'amount')::numeric, 0), 0),
      coalesce(NULLIF(p->>'category',''), 'other'),
      greatest(coalesce((p->>'spreadMonths')::int, 1), 1),
      NULLIF(p->>'note','')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE manual_expenses SET
      date = coalesce((p->>'date')::date, date),
      amount = greatest(coalesce((p->>'amount')::numeric, amount), 0),
      category = coalesce(NULLIF(p->>'category',''), category),
      spread_months = greatest(coalesce((p->>'spreadMonths')::int, spread_months), 1),
      note = NULLIF(p->>'note','')
    WHERE id = v_id;
  END IF;
  RETURN QUERY SELECT * FROM manual_expenses WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION manual_expense_delete(p_id uuid)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM manual_expenses WHERE id = p_id;
$$;

-- Tổng chi phí thủ công (đã phân bổ) rơi trong kỳ [from,to] — mirror asset_depreciation.
-- Dùng trong revenue.sql (plpgsql, resolve runtime → an toàn thứ tự apply).
CREATE OR REPLACE FUNCTION manual_expense_allocated(p_from timestamptz, p_to timestamptz)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(SUM(m.amount / m.spread_months), 0)
  FROM manual_expenses m
  CROSS JOIN LATERAL generate_series(0, m.spread_months - 1) AS i
  WHERE (m.date::timestamptz + (i || ' months')::interval) BETWEEN p_from AND p_to;
$$;
