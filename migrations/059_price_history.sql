-- 059: Lịch sử đổi giá sản phẩm — tự ghi qua trigger khi products.price đổi.
CREATE TABLE IF NOT EXISTS price_history (
  id           serial PRIMARY KEY,
  product_id   text,
  product_name text,
  old_price    numeric,
  new_price    numeric,
  note         text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, changed_at DESC);

CREATE OR REPLACE FUNCTION product_price_history_log()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO price_history (product_id, product_name, old_price, new_price)
    VALUES (NEW.id, NEW.name, OLD.price, NEW.price);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_price_history ON products;
CREATE TRIGGER trg_product_price_history
  AFTER UPDATE OF price ON products
  FOR EACH ROW EXECUTE FUNCTION product_price_history_log();

-- Hàm đọc lịch sử (mới nhất trước)
CREATE OR REPLACE FUNCTION price_history_list(p_limit integer DEFAULT 200)
RETURNS SETOF price_history LANGUAGE sql STABLE AS $$
  SELECT * FROM price_history ORDER BY changed_at DESC, id DESC LIMIT COALESCE(p_limit, 200);
$$;
