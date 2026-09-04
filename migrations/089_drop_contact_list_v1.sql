-- Bỏ bản 3 tham số của facebook_contact_list (087 thêm p_platform có DEFAULT).
-- Để cả hai thì gọi 3 tham số sẽ "function is not unique"; mọi caller giờ truyền 4.
-- (Phải là migration riêng vì 087 đã được đánh dấu applied trên prod.)
DROP FUNCTION IF EXISTS facebook_contact_list(text, int, int);
