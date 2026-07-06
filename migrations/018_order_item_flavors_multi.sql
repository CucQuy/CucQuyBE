-- Chuyển vị của dòng đơn từ 1 vị (flavor text) sang NHIỀU vị (flavors text[]).
-- Giữ cột flavor cũ (legacy, nullable) để an toàn; migrate dữ liệu cũ sang mảng.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS flavors text[];
UPDATE order_items
  SET flavors = ARRAY[flavor]
  WHERE flavor IS NOT NULL AND flavor <> '' AND flavors IS NULL;
