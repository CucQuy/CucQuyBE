-- ============================================================
-- 102 — COMBO = danh sách SẢN PHẨM CÓ SẴN, không phải ghi chú text.
--
-- Trước: box mix chỉ mô tả thành phần trong `products.description` → không tra được
-- box gồm những SP nào, không tự tính "giá lẻ cộng lại", đổi giá món lẻ không lan ra box.
-- Nay: 1 dòng = 1 món trong box, trỏ thẳng `products.id`.
--
--   qty      : số PHẦN trong box (2 viên phô mai dẻo → 2)
--   portion  : 1 phần = bao nhiêu ĐƠN VỊ BÁN LẺ của SP đó
--              (phô mai dẻo bán hộp 10 cái → 0.1; bánh mì chuối bán ổ 5 lát → 0.2; canelé → 1)
--   giá lẻ 1 phần = products.price * portion
--
-- Function đi kèm (chạy SAU migration này):
--   functions/product_combos.sql — product_combo_get / product_combo_list / product_combo_save
-- ============================================================

CREATE TABLE IF NOT EXISTS product_combo_items (
  id         serial PRIMARY KEY,
  combo_id   text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  item_id    text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty        numeric NOT NULL DEFAULT 1 CHECK (qty > 0),
  portion    numeric NOT NULL DEFAULT 1 CHECK (portion > 0 AND portion <= 1),
  unit_label text,                                  -- nhãn hiển thị: 'cái' | 'lát' | 'viên'
  sort_order integer NOT NULL DEFAULT 0,
  note       text,
  CHECK (combo_id <> item_id),
  UNIQUE (combo_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_product_combo_items_combo ON product_combo_items(combo_id);
CREATE INDEX IF NOT EXISTS idx_product_combo_items_item  ON product_combo_items(item_id);
