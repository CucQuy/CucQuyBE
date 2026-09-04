-- comment_list nay có thêm p_post_id (5 tham số, 2 cái cuối có DEFAULT).
-- Bản 4 tham số cũ phải bỏ, kẻo gọi 4 args sẽ "function is not unique".
-- (Migration riêng vì 087/089 đã được đánh dấu applied trên prod.)
DROP FUNCTION IF EXISTS facebook_comment_list(text, int, int, text);
