-- ============================================================
-- Domain: commission_groups — toàn bộ logic ở DB, BE chỉ gọi.
-- Quan hệ: commission_groups (1) — (n) commission_group_tiers (FK group_id ON DELETE CASCADE).
-- Tiers (FE: mảng nhúng) nay là bảng con; hàm trả group kèm jsonb_agg tiers theo sort_order.
-- ============================================================

-- ------------------------------------------------------------
-- Sinh id ngẫu nhiên 20 ký tự (giống Firestore auto-id).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION commission_group_gen_id()
RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(
    substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
           (floor(random() * 62) + 1)::int, 1),
    '')
  FROM generate_series(1, 20);
$$;

-- ------------------------------------------------------------
-- Danh sách nhóm hoa hồng kèm mảng tiers (jsonb), sắp theo sort_order.
-- Mỗi dòng: cột group + cột tiers jsonb [{minQty,profitShareRate}] (sắp theo tier.sort_order).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION commission_group_list()
RETURNS TABLE (
  id                text,
  name              text,
  min_margin        numeric,
  max_margin        numeric,
  profit_share_rate numeric,
  fallback_rate     numeric,
  sort_order        integer,
  tiers             jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT
    g.id, g.name, g.min_margin, g.max_margin, g.profit_share_rate,
    g.fallback_rate, g.sort_order,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object('minQty', t.min_qty, 'profitShareRate', t.profit_share_rate)
                ORDER BY t.sort_order, t.id)
       FROM commission_group_tiers t
       WHERE t.group_id = g.id),
      '[]'::jsonb
    ) AS tiers
  FROM commission_groups g
  ORDER BY g.sort_order NULLS LAST, g.name;
$$;

-- ------------------------------------------------------------
-- Helper nội bộ: ghi đè toàn bộ tiers của 1 group từ jsonb array.
-- p_tiers: [{minQty,profitShareRate}] (camelCase). NULL = không đụng tiers.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION commission_group_replace_tiers(p_group_id text, p_tiers jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_tiers IS NULL OR jsonb_typeof(p_tiers) <> 'array' THEN
    RETURN; -- không gửi tiers → giữ nguyên
  END IF;

  DELETE FROM commission_group_tiers WHERE group_id = p_group_id;

  INSERT INTO commission_group_tiers (group_id, min_qty, profit_share_rate, sort_order)
  SELECT
    p_group_id,
    COALESCE(NULLIF(x->>'minQty','')::int, 1),
    COALESCE(NULLIF(x->>'profitShareRate','')::numeric, 0),
    (ord - 1)::int
  FROM jsonb_array_elements(p_tiers) WITH ORDINALITY AS e(x, ord);
END;
$$;

-- ------------------------------------------------------------
-- Tạo nhóm mới (sinh id) + tiers. Trả về group mới kèm tiers (1 dòng).
-- p jsonb: {name,minMargin,maxMargin,profitShareRate,fallbackRate,order|sortOrder,tiers:[...]}
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION commission_group_create(p jsonb)
RETURNS TABLE (
  id text, name text, min_margin numeric, max_margin numeric,
  profit_share_rate numeric, fallback_rate numeric, sort_order integer, tiers jsonb
)
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := commission_group_gen_id();
BEGIN
  INSERT INTO commission_groups
    (id, name, min_margin, max_margin, profit_share_rate, fallback_rate, sort_order)
  VALUES (
    v_id,
    COALESCE(p->>'name',''),
    COALESCE(NULLIF(p->>'minMargin','')::numeric, 0),
    COALESCE(NULLIF(p->>'maxMargin','')::numeric, 1),
    NULLIF(p->>'profitShareRate','')::numeric,
    COALESCE(NULLIF(p->>'fallbackRate','')::numeric, 0),
    COALESCE(NULLIF(p->>'sortOrder','')::int, NULLIF(p->>'order','')::int, 0)
  );

  PERFORM commission_group_replace_tiers(v_id, p->'tiers');

  RETURN QUERY SELECT * FROM commission_group_list() l WHERE l.id = v_id;
END;
$$;

-- ------------------------------------------------------------
-- Cập nhật nhóm (partial: chỉ field có trong p mới ghi đè).
-- Nếu p có key 'tiers' (array) → thay toàn bộ tiers; không có → giữ nguyên.
-- Trả về group sau cập nhật kèm tiers (1 dòng).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION commission_group_update(p_id text, p jsonb)
RETURNS TABLE (
  id text, name text, min_margin numeric, max_margin numeric,
  profit_share_rate numeric, fallback_rate numeric, sort_order integer, tiers jsonb
)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE commission_groups AS g SET
    name              = CASE WHEN p ? 'name'            THEN COALESCE(p->>'name','')                   ELSE g.name END,
    min_margin        = CASE WHEN p ? 'minMargin'       THEN NULLIF(p->>'minMargin','')::numeric       ELSE g.min_margin END,
    max_margin        = CASE WHEN p ? 'maxMargin'       THEN NULLIF(p->>'maxMargin','')::numeric       ELSE g.max_margin END,
    profit_share_rate = CASE WHEN p ? 'profitShareRate' THEN NULLIF(p->>'profitShareRate','')::numeric ELSE g.profit_share_rate END,
    fallback_rate     = CASE WHEN p ? 'fallbackRate'    THEN NULLIF(p->>'fallbackRate','')::numeric    ELSE g.fallback_rate END,
    sort_order        = CASE
                          WHEN p ? 'sortOrder' THEN NULLIF(p->>'sortOrder','')::int
                          WHEN p ? 'order'     THEN NULLIF(p->>'order','')::int
                          ELSE g.sort_order
                        END
  WHERE g.id = p_id;

  IF p ? 'tiers' THEN
    PERFORM commission_group_replace_tiers(p_id, p->'tiers');
  END IF;

  RETURN QUERY SELECT * FROM commission_group_list() l WHERE l.id = p_id;
END;
$$;

-- ------------------------------------------------------------
-- Xoá nhóm (tiers tự cascade). Trả về số dòng đã xoá.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION commission_group_delete(p_id text)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM commission_groups WHERE id = p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
