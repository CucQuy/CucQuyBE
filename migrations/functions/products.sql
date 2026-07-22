-- ============================================================
-- Domain: products — toàn bộ logic ở DB, BE chỉ gọi.
-- 3 bảng: products, product_versions, product_version_changes.
-- products có CẢ category_id (FK->categories) lẫn category (text tên).
--   Khi tạo/sửa: resolve category_id từ tên category, giữ cả 2.
-- UPDATE: ghi 1 product_versions(action='update') + diff từng field
--   thay đổi vào product_version_changes (before/after stringify text).
-- ============================================================

-- Sinh id kiểu Firestore auto-id (20 ký tự alphanumeric).
CREATE OR REPLACE FUNCTION product_gen_id()
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

-- Resolve category_id từ tên category (NULL nếu rỗng / không khớp).
CREATE OR REPLACE FUNCTION product_resolve_category_id(p_category text)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT id FROM categories
  WHERE name = NULLIF(p_category, '')
  LIMIT 1;
$$;

-- Liệt kê sản phẩm (mới nhất trước).
CREATE OR REPLACE FUNCTION product_list()
RETURNS SETOF products
LANGUAGE sql STABLE AS $$
  SELECT * FROM products ORDER BY created_at DESC NULLS LAST, id;
$$;

-- Lấy 1 sản phẩm theo id.
CREATE OR REPLACE FUNCTION product_get(p_id text)
RETURNS SETOF products
LANGUAGE sql STABLE AS $$
  SELECT * FROM products WHERE id = p_id;
$$;

-- Tạo sản phẩm mới từ JSON client (camelCase). Tự sinh id, resolve category_id.
-- p: {name,price,costPrice,description,status,category,categoryId,tags,image,
--     gallery,recipeId,cakesPerProduct}
-- Trả về dòng vừa tạo.
CREATE OR REPLACE FUNCTION product_create(p jsonb)
RETURNS SETOF products
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := product_gen_id();
  v_category text := NULLIF(p->>'category', '');
  v_category_id text;
BEGIN
  -- ưu tiên categoryId client gửi, nếu rỗng thì resolve từ tên category.
  v_category_id := COALESCE(
    NULLIF(p->>'categoryId', ''),
    product_resolve_category_id(v_category)
  );

  RETURN QUERY
  INSERT INTO products (
    id, name, price, cost_price, description, status,
    category_id, category, tags, image, gallery, recipe_id,
    cakes_per_product, flavors, sizes, flavor_variants,
    type, price_tiers, add_on_product_ids, created_at
  ) VALUES (
    v_id,
    COALESCE(p->>'name', ''),
    NULLIF(p->>'price', '')::numeric,
    NULLIF(p->>'costPrice', '')::numeric,
    NULLIF(p->>'description', ''),
    COALESCE(NULLIF(p->>'status', ''), 'active'),
    v_category_id,
    v_category,
    CASE WHEN p ? 'tags' AND jsonb_typeof(p->'tags') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p->'tags')) ELSE NULL END,
    NULLIF(p->>'image', ''),
    CASE WHEN p ? 'gallery' AND jsonb_typeof(p->'gallery') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p->'gallery')) ELSE NULL END,
    NULLIF(p->>'recipeId', ''),
    NULLIF(p->>'cakesPerProduct', '')::numeric,
    CASE WHEN p ? 'flavors' AND jsonb_typeof(p->'flavors') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p->'flavors')) ELSE NULL END,
    CASE WHEN jsonb_typeof(p->'sizes') = 'array' THEN p->'sizes' ELSE NULL END,
    CASE WHEN jsonb_typeof(p->'flavorVariants') = 'array' THEN p->'flavorVariants' ELSE NULL END,
    NULLIF(p->>'type', ''),
    CASE WHEN jsonb_typeof(p->'priceTiers') = 'array' THEN p->'priceTiers' ELSE NULL END,
    CASE WHEN jsonb_typeof(p->'addOnProductIds') = 'array' THEN p->'addOnProductIds' ELSE NULL END,
    now()
  )
  RETURNING *;
END;
$$;

-- Cập nhật sản phẩm + ghi version + diff. Chỉ áp field CÓ MẶT trong p (jsonb key tồn tại).
-- Resolve lại category_id khi 'category' đổi (nếu client không gửi categoryId).
-- So before vs after trên các cột bị đụng, ghi product_version_changes.
-- Raise PRODUCT_NOT_FOUND nếu id không tồn tại. Trả về dòng đã cập nhật.
CREATE OR REPLACE FUNCTION product_update(p_id text, p jsonb)
RETURNS SETOF products
LANGUAGE plpgsql AS $$
DECLARE
  v_before products%ROWTYPE;
  v_after products%ROWTYPE;
  v_version_id text;
  v_change_count int := 0;
  v_set_category boolean := false;
BEGIN
  SELECT * INTO v_before FROM products WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  v_after := v_before;

  -- Áp field nếu key có mặt trong jsonb (cho phép set NULL bằng giá trị null).
  IF p ? 'name' THEN v_after.name := COALESCE(p->>'name', ''); END IF;
  IF p ? 'price' THEN v_after.price := NULLIF(p->>'price', '')::numeric; END IF;
  IF p ? 'costPrice' THEN v_after.cost_price := NULLIF(p->>'costPrice', '')::numeric; END IF;
  IF p ? 'description' THEN v_after.description := NULLIF(p->>'description', ''); END IF;
  IF p ? 'status' THEN v_after.status := NULLIF(p->>'status', ''); END IF;
  IF p ? 'image' THEN v_after.image := NULLIF(p->>'image', ''); END IF;
  IF p ? 'recipeId' THEN v_after.recipe_id := NULLIF(p->>'recipeId', ''); END IF;
  IF p ? 'cakesPerProduct' THEN v_after.cakes_per_product := NULLIF(p->>'cakesPerProduct', '')::numeric; END IF;
  IF p ? 'tags' THEN
    v_after.tags := CASE WHEN jsonb_typeof(p->'tags') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p->'tags')) ELSE NULL END;
  END IF;
  IF p ? 'gallery' THEN
    v_after.gallery := CASE WHEN jsonb_typeof(p->'gallery') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p->'gallery')) ELSE NULL END;
  END IF;
  IF p ? 'flavors' THEN
    v_after.flavors := CASE WHEN jsonb_typeof(p->'flavors') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p->'flavors')) ELSE NULL END;
  END IF;
  IF p ? 'sizes' THEN
    v_after.sizes := CASE WHEN jsonb_typeof(p->'sizes') = 'array' THEN p->'sizes' ELSE NULL END;
  END IF;
  IF p ? 'flavorVariants' THEN
    v_after.flavor_variants := CASE WHEN jsonb_typeof(p->'flavorVariants') = 'array' THEN p->'flavorVariants' ELSE NULL END;
  END IF;
  IF p ? 'type' THEN v_after.type := NULLIF(p->>'type', ''); END IF;
  IF p ? 'priceTiers' THEN
    v_after.price_tiers := CASE WHEN jsonb_typeof(p->'priceTiers') = 'array' THEN p->'priceTiers' ELSE NULL END;
  END IF;
  IF p ? 'addOnProductIds' THEN
    v_after.add_on_product_ids := CASE WHEN jsonb_typeof(p->'addOnProductIds') = 'array' THEN p->'addOnProductIds' ELSE NULL END;
  END IF;

  -- category / categoryId: nếu category đổi thì resolve lại category_id (trừ khi client gửi categoryId).
  IF p ? 'category' THEN
    v_after.category := NULLIF(p->>'category', '');
    v_set_category := true;
  END IF;
  IF p ? 'categoryId' THEN
    v_after.category_id := NULLIF(p->>'categoryId', '');
  ELSIF v_set_category THEN
    v_after.category_id := product_resolve_category_id(v_after.category);
  END IF;

  -- Ghi cập nhật.
  UPDATE products SET
    name = v_after.name,
    price = v_after.price,
    cost_price = v_after.cost_price,
    description = v_after.description,
    status = v_after.status,
    category_id = v_after.category_id,
    category = v_after.category,
    tags = v_after.tags,
    image = v_after.image,
    gallery = v_after.gallery,
    recipe_id = v_after.recipe_id,
    cakes_per_product = v_after.cakes_per_product,
    flavors = v_after.flavors,
    sizes = v_after.sizes,
    flavor_variants = v_after.flavor_variants,
    type = v_after.type,
    price_tiers = v_after.price_tiers,
    add_on_product_ids = v_after.add_on_product_ids
  WHERE id = p_id;

  -- Tạo bản version + diff từng field thay đổi.
  v_version_id := product_gen_id();
  INSERT INTO product_versions (id, product_id, action, edited_at)
  VALUES (v_version_id, p_id, 'update', now());

  -- helper: so từng cột (text stringify), insert change nếu khác.
  INSERT INTO product_version_changes (version_id, field, before_value, after_value)
  SELECT v_version_id, d.field, d.before_value, d.after_value
  FROM (
    VALUES
      ('name',            v_before.name,                              v_after.name),
      ('price',           v_before.price::text,                       v_after.price::text),
      ('costPrice',       v_before.cost_price::text,                  v_after.cost_price::text),
      ('description',     v_before.description,                       v_after.description),
      ('status',          v_before.status,                            v_after.status),
      ('categoryId',      v_before.category_id,                       v_after.category_id),
      ('category',        v_before.category,                          v_after.category),
      ('tags',            array_to_string(v_before.tags, ','),        array_to_string(v_after.tags, ',')),
      ('image',           v_before.image,                             v_after.image),
      ('gallery',         array_to_string(v_before.gallery, ','),     array_to_string(v_after.gallery, ',')),
      ('recipeId',        v_before.recipe_id,                         v_after.recipe_id),
      ('cakesPerProduct', v_before.cakes_per_product::text,           v_after.cakes_per_product::text),
      ('flavors',         array_to_string(v_before.flavors, ','),     array_to_string(v_after.flavors, ',')),
      ('sizes',           v_before.sizes::text,                       v_after.sizes::text),
      ('flavorVariants',  v_before.flavor_variants::text,             v_after.flavor_variants::text),
      ('type',            v_before.type,                              v_after.type),
      ('priceTiers',      v_before.price_tiers::text,                 v_after.price_tiers::text),
      ('addOnProductIds', v_before.add_on_product_ids::text,          v_after.add_on_product_ids::text)
  ) AS d(field, before_value, after_value)
  WHERE d.before_value IS DISTINCT FROM d.after_value;

  GET DIAGNOSTICS v_change_count = ROW_COUNT;
  -- nếu không có field nào đổi: bỏ luôn bản version rỗng (giống service cũ không ghi khi updates rỗng).
  IF v_change_count = 0 THEN
    DELETE FROM product_versions WHERE id = v_version_id;
  END IF;

  RETURN QUERY SELECT * FROM products WHERE id = p_id;
END;
$$;

-- Xoá field costPrice (đưa ra khỏi danh sách "đã có hoa hồng"). Ghi version diff.
-- No-op nếu cost_price đã NULL. Raise PRODUCT_NOT_FOUND nếu không tồn tại.
CREATE OR REPLACE FUNCTION product_remove_cost_price(p_id text)
RETURNS SETOF products
LANGUAGE plpgsql AS $$
DECLARE
  v_before products%ROWTYPE;
  v_version_id text;
BEGIN
  SELECT * INTO v_before FROM products WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  IF v_before.cost_price IS NULL THEN
    RETURN QUERY SELECT * FROM products WHERE id = p_id;
    RETURN;
  END IF;

  UPDATE products SET cost_price = NULL WHERE id = p_id;

  v_version_id := product_gen_id();
  INSERT INTO product_versions (id, product_id, action, edited_at)
  VALUES (v_version_id, p_id, 'update', now());
  INSERT INTO product_version_changes (version_id, field, before_value, after_value)
  VALUES (v_version_id, 'costPrice', v_before.cost_price::text, NULL);

  RETURN QUERY SELECT * FROM products WHERE id = p_id;
END;
$$;

-- Xoá sản phẩm (versions/changes tự cascade theo FK).
CREATE OR REPLACE FUNCTION product_delete(p_id text)
RETURNS void
LANGUAGE sql AS $$
  DELETE FROM products WHERE id = p_id;
$$;

-- Lịch sử version của 1 sản phẩm (mới nhất trước).
-- Trả jsonb array, mỗi item gộp lại shape cũ:
--   { id, productId, action, editedAt, changes:{field:after}, before:{field:before}, after:{field:after} }
CREATE OR REPLACE FUNCTION product_versions(p_product_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', v.id,
      'productId', v.product_id,
      'action', COALESCE(v.action, 'update'),
      'editedAt', v.edited_at,
      'before', COALESCE((
        SELECT jsonb_object_agg(c.field, c.before_value)
        FROM product_version_changes c WHERE c.version_id = v.id
      ), '{}'::jsonb),
      'changes', COALESCE((
        SELECT jsonb_object_agg(c.field, c.after_value)
        FROM product_version_changes c WHERE c.version_id = v.id
      ), '{}'::jsonb),
      'after', COALESCE((
        SELECT jsonb_object_agg(c.field, c.after_value)
        FROM product_version_changes c WHERE c.version_id = v.id
      ), '{}'::jsonb)
    ) ORDER BY v.edited_at DESC NULLS LAST, v.id DESC
  ), '[]'::jsonb)
  FROM product_versions v
  WHERE v.product_id = p_product_id;
$$;
