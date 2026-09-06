-- shift_assignment_remove nay có thêm p_by (2 tham số, cái sau có DEFAULT).
-- Bản 1 tham số cũ phải bỏ, kẻo gọi 1 arg sẽ "function is not unique".
-- (Migration riêng vì 093 đã được đánh dấu applied trên prod.)
DROP FUNCTION IF EXISTS shift_assignment_remove(text);
