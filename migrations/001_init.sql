-- ============================================================
-- CucQuy — schema khởi tạo (Firestore → Postgres, RAW SQL, FULL RELATIONAL)
-- Nguyên tắc: object lồng → cột phẳng; mảng-các-object → bảng con + FK;
--             chỉ mảng scalar (tags, gallery, product_ids…) giữ text[].
-- Doc id Firestore là string → PK text để bảo toàn tham chiếu.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------- Người dùng / khách ----------
CREATE TABLE users (
  uid text PRIMARY KEY, email text, display_name text, custom_name text,
  photo_url text, role text, status text, zalo_ctv_group_chat_id text,
  last_login_at text, created_at text
);

CREATE TABLE customers (
  id text PRIMARY KEY, name text NOT NULL, phone text, created_at timestamptz
);

-- ---------- Danh mục (cây) ----------
CREATE TABLE categories (
  id text PRIMARY KEY, name text NOT NULL,
  parent_id text REFERENCES categories(id) DEFERRABLE INITIALLY DEFERRED,
  icon text, color text, sort_order int, description text
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

-- ---------- Công thức ----------
CREATE TABLE recipes (
  id text PRIMARY KEY, name text, description text, instructions text,
  yield numeric, yield_unit text, waste_rate numeric, recipe_type text,
  base_recipe_id text REFERENCES recipes(id) DEFERRABLE INITIALLY DEFERRED,
  output_quantity numeric, created_at timestamptz, updated_at timestamptz
);

-- ---------- Nhà cung cấp / nguyên liệu ----------
CREATE TABLE suppliers (
  id text PRIMARY KEY, name text, normalized_name text, receipt_count int,
  total_amount numeric, last_receipt_date text, phone text, address text,
  created_at timestamptz, updated_at timestamptz
);

CREATE TABLE materials (
  id text PRIMARY KEY, name text, normalized_name text, canonical_unit text,
  import_count int, total_qty numeric, total_amount numeric, last_unit_price numeric,
  last_supplier_id text REFERENCES suppliers(id) ON DELETE SET NULL,
  last_supplier_name text, last_receipt_date text,
  created_at timestamptz, updated_at timestamptz
);

-- ---------- Sản phẩm ----------
CREATE TABLE products (
  id text PRIMARY KEY, name text NOT NULL, price numeric, cost_price numeric,
  description text, status text,
  category_id text REFERENCES categories(id) ON DELETE SET NULL,  -- 1:n (categories → products)
  category text,                       -- tên danh mục (denormalized, tiện cho transition)
  tags text[], image text, gallery text[],
  recipe_id text REFERENCES recipes(id) ON DELETE SET NULL,        -- 1:n (recipes → products)
  cakes_per_product numeric, created_at timestamptz
);
CREATE INDEX idx_products_category_id ON products(category_id);

CREATE TABLE product_versions (
  id text PRIMARY KEY,
  product_id text REFERENCES products(id) ON DELETE CASCADE,
  action text, edited_at timestamptz
);
CREATE INDEX idx_pv_product ON product_versions(product_id);

-- diff từng field (thay cho before/after/changes jsonb)
CREATE TABLE product_version_changes (
  id           bigserial PRIMARY KEY,
  version_id   text NOT NULL REFERENCES product_versions(id) ON DELETE CASCADE,
  field        text,
  before_value text,
  after_value  text
);
CREATE INDEX idx_pvc_version ON product_version_changes(version_id);

-- ---------- Phiếu nhập kho ----------
CREATE TABLE stock_receipts (
  id text PRIMARY KEY,
  supplier_id text REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name_raw text, supplier_name_canonical text, store_or_branch text,
  invoice_number text, supplier_phone text, supplier_address text,
  receipt_date text, receipt_time text, subtotal numeric, tax numeric, discount numeric,
  total_amount numeric, currency text, payment_method text, notes text,
  product_line_count int, ocr_text text, receipt_image_base64 text, receipt_image_mime_type text,
  -- validation (object) → cột phẳng
  validation_is_likely_receipt boolean, validation_confidence numeric,
  validation_reason_vi text, validation_heuristic_score numeric, validation_heuristic_note_vi text,
  -- amount_check (object) → cột phẳng
  amount_check_sum_lines numeric, amount_check_delta_pct numeric, amount_check_warn boolean,
  bill_hash text, status text, created_by_uid text, created_at timestamptz, updated_at timestamptz
);

CREATE TABLE stock_receipt_lines (
  id text PRIMARY KEY,
  receipt_id text REFERENCES stock_receipts(id) ON DELETE CASCADE,
  material_id text REFERENCES materials(id) ON DELETE SET NULL,
  material_name_raw text, name text, quantity numeric, unit text,
  unit_price numeric, line_total numeric, supplier_id text, receipt_date text, created_at timestamptz
);
CREATE INDEX idx_srl_receipt ON stock_receipt_lines(receipt_id);

-- ---------- Khuyến mãi ----------
CREATE TABLE promotions (
  id text PRIMARY KEY, name text, apply_mode text, code text,
  discount_type text, discount_value numeric, max_discount numeric,
  group_category_id text REFERENCES categories(id) ON DELETE SET NULL,  -- nhóm BUY_X_GET_Y (1:n)
  group_badge_id text, buy_quantity int, get_quantity int,
  scope text, min_order_value numeric,
  start_at text, end_at text, max_uses int, used_count int, status text, priority int,
  created_by text, created_at text, updated_at text
);

-- n:n  promotions ↔ products  (scope = PRODUCTS)
CREATE TABLE promotion_products (
  promotion_id text NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id   text NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);
-- n:n  promotions ↔ categories  (scope = CATEGORIES)
CREATE TABLE promotion_categories (
  promotion_id text NOT NULL REFERENCES promotions(id)  ON DELETE CASCADE,
  category_id  text NOT NULL REFERENCES categories(id)  ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, category_id)
);

-- ---------- Đơn hàng ----------
CREATE TABLE orders (
  id text PRIMARY KEY,
  order_number text,                  -- KHÔNG unique lúc tạo: data có trùng, ETL renumber rồi mới bật UNIQUE
  order_date timestamptz,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  -- customer (object) → cột phẳng (snapshot lúc đặt)
  customer_name text, phone text, address text, email text, customer_city text, customer_country text,
  subtotal numeric, shipping_cost numeric, discount_amount numeric, total numeric,
  payment_status text, payment_method text, status text, delivery_type text,
  delivery_date text, delivery_time text, note text, sepay_id text,
  commission_status text, commission_paid_at text, is_test boolean,
  created_by text, updated_by text, created_at timestamptz, updated_at timestamptz
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_orders_order_number ON orders(order_number);

CREATE TABLE order_items (
  id bigserial PRIMARY KEY,
  order_id text REFERENCES orders(id) ON DELETE CASCADE,
  product_id text REFERENCES products(id) ON DELETE SET NULL,   -- n:n orders↔products
  product_name text, unit_price numeric, quantity numeric, image text
);
CREATE INDEX idx_oi_order ON order_items(order_id);
CREATE INDEX idx_oi_product ON order_items(product_id);

CREATE TABLE order_decorations (
  id bigserial PRIMARY KEY,
  order_id text REFERENCES orders(id) ON DELETE CASCADE,
  name text, price numeric, quantity numeric
);
CREATE INDEX idx_od_order ON order_decorations(order_id);

CREATE TABLE order_gift_items (
  id bigserial PRIMARY KEY,
  order_id text REFERENCES orders(id) ON DELETE CASCADE,
  product_id text REFERENCES products(id) ON DELETE SET NULL,
  name text, image text, quantity numeric, price numeric
);
CREATE INDEX idx_ogi_order ON order_gift_items(order_id);

CREATE TABLE order_applied_promotions (
  id bigserial PRIMARY KEY,
  order_id text REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id text REFERENCES promotions(id) ON DELETE SET NULL,  -- n:n orders↔promotions
  code text, name text, type text, amount numeric
);
CREATE INDEX idx_oap_order ON order_applied_promotions(order_id);
CREATE INDEX idx_oap_promo ON order_applied_promotions(promotion_id);

CREATE TABLE order_history (
  id bigserial PRIMARY KEY,
  order_id text REFERENCES orders(id) ON DELETE CASCADE,
  at timestamptz, by_name text, by_uid text
);
CREATE INDEX idx_oh_order ON order_history(order_id);

CREATE TABLE order_history_changes (
  id bigserial PRIMARY KEY,
  history_id bigint NOT NULL REFERENCES order_history(id) ON DELETE CASCADE,
  field text, label text, old_value text, new_value text
);
CREATE INDEX idx_ohc_history ON order_history_changes(history_id);

-- ---------- Giao dịch SePay ----------
CREATE TABLE transactions (
  id text PRIMARY KEY, sepay_id bigint, gateway text, transaction_date text,
  account_number text, code text, content text, transfer_type text,
  transfer_amount numeric, accumulated numeric, sub_account text, reference_code text,
  description text,
  order_number text,  -- FK -> orders(order_number) thêm ở CUỐI ETL (sau khi orders.order_number có UNIQUE)
  is_external boolean,
  received_at timestamptz, created_at timestamptz
);
CREATE INDEX idx_tx_order_number ON transactions(order_number);

-- ---------- Hoa hồng (nhóm + bậc) ----------
CREATE TABLE commission_groups (
  id text PRIMARY KEY, name text, min_margin numeric, max_margin numeric,
  profit_share_rate numeric, fallback_rate numeric, sort_order int
);
CREATE TABLE commission_group_tiers (
  id bigserial PRIMARY KEY,
  group_id text NOT NULL REFERENCES commission_groups(id) ON DELETE CASCADE,
  min_qty int, profit_share_rate numeric, sort_order int
);
CREATE INDEX idx_cgt_group ON commission_group_tiers(group_id);

-- ---------- Badge ----------
CREATE TABLE product_badges (id text PRIMARY KEY, name text, color text, icon text, sort_order int, description text);
CREATE TABLE order_badges   (id text PRIMARY KEY, name text, color text, icon text, sort_order int, description text);
CREATE TABLE customer_badge_rules (
  id text PRIMARY KEY, name text, color text, icon text,
  rule_type text, operator text, threshold numeric, sort_order int, description text
);

-- ---------- Tin nhắn Facebook ----------
CREATE TABLE facebook_messages (
  id text PRIMARY KEY, id_new_message text, id_page text, page_scope_id text,
  id_conversion text, id_cong_ty bigint, message text, type int, is_phone int,
  use_webhook int, url_webhook text, app_id text, page_name text, customer_name text,
  number_phone text, country_code text, sent_by_shop int, ai_disabled boolean,
  content_type text, source_created_at text, received_at timestamptz, created_at timestamptz
);
CREATE TABLE facebook_message_attachments (
  id bigserial PRIMARY KEY,
  message_id text NOT NULL REFERENCES facebook_messages(id) ON DELETE CASCADE,
  type text, url text
);
CREATE INDEX idx_fma_message ON facebook_message_attachments(message_id);

-- ---------- Cấu hình app (settings — key/value; KHÔNG phải data entity) ----------
-- screen visibility: map route->bool
CREATE TABLE screen_visibility (route text PRIMARY KEY, visible boolean);
-- shipping: 1 dòng cấu hình + bảng bậc phí theo km
CREATE TABLE shipping_config (
  id text PRIMARY KEY DEFAULT 'shipping', over_fee numeric, over_label text, shop_origin jsonb
);
CREATE TABLE shipping_tiers (
  id bigserial PRIMARY KEY, max_km numeric, fee numeric, label text, sort_order int
);
-- zalo: 1 dòng cấu hình chính + nhóm CTV
CREATE TABLE zalo_config (
  id text PRIMARY KEY DEFAULT 'zalo', main_group_id text,
  main_notify_on_create boolean, main_notify_on_update boolean, main_notify_on_delete boolean,
  main_update_field_whitelist text[]
);
CREATE TABLE zalo_groups (
  id text PRIMARY KEY, name text, zalo_group_id text,
  notify_on_create boolean, notify_on_update boolean, notify_on_delete boolean,
  update_field_whitelist text[]      -- mảng scalar (tên field) → giữ text[]
);
-- n:n  zalo_groups ↔ users (thành viên CTV của nhóm)
CREATE TABLE zalo_group_members (
  group_id  text NOT NULL REFERENCES zalo_groups(id) ON DELETE CASCADE,
  user_uid  text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,  -- n:n zalo_groups↔users
  PRIMARY KEY (group_id, user_uid)
);

-- ---------- Log request (ephemeral, TTL — KHÔNG nạp data cũ) ----------
CREATE TABLE request_logs (
  id text PRIMARY KEY, method text, path text, query text, status_code int,
  duration_ms int, response_size int, ip text, geo jsonb, uid text, email text,
  role text, user_agent text, referer text, body text, timestamp timestamptz, expire_at timestamptz
);
