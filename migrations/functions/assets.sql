-- Tài sản / CSVC + khấu hao. Idempotent (CREATE OR REPLACE). Xem migrations/012_assets.sql.

CREATE OR REPLACE FUNCTION asset_list()
RETURNS SETOF assets LANGUAGE sql STABLE AS $$
  SELECT * FROM assets ORDER BY start_date DESC, created_at DESC;
$$;

-- Tạo/sửa 1 tài sản (có id → update; không → insert). Trả bản ghi.
CREATE OR REPLACE FUNCTION asset_upsert(p jsonb)
RETURNS SETOF assets LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  v_id := NULLIF(p->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO assets (name, cost, useful_months, start_date, category, note)
    VALUES (
      p->>'name',
      coalesce((p->>'cost')::numeric, 0),
      greatest(coalesce((p->>'usefulMonths')::int, 1), 1),
      coalesce((p->>'startDate')::date, current_date),
      NULLIF(p->>'category',''),
      NULLIF(p->>'note','')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE assets SET
      name = p->>'name',
      cost = coalesce((p->>'cost')::numeric, cost),
      useful_months = greatest(coalesce((p->>'usefulMonths')::int, useful_months), 1),
      start_date = coalesce((p->>'startDate')::date, start_date),
      category = NULLIF(p->>'category',''),
      note = NULLIF(p->>'note','')
    WHERE id = v_id;
  END IF;
  RETURN QUERY SELECT * FROM assets WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION asset_delete(p_id uuid)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM assets WHERE id = p_id;
$$;

-- Khấu hao rơi trong kỳ [p_from, p_to]: mỗi tài sản, mỗi tháng khấu hao (i=0..M-1) có
-- mốc = start_date + i tháng; nếu mốc ∈ kỳ → cộng cost/useful_months.
CREATE OR REPLACE FUNCTION asset_depreciation(p_from timestamptz, p_to timestamptz)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(SUM(a.cost / a.useful_months), 0)
  FROM assets a
  CROSS JOIN LATERAL generate_series(0, a.useful_months - 1) AS i
  WHERE (a.start_date::timestamptz + (i || ' months')::interval) BETWEEN p_from AND p_to;
$$;
