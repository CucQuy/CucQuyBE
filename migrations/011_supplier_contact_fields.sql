-- ============================================================
-- 011 — Bổ sung field liên hệ NCC cho bảng suppliers.
--
-- Bối cảnh: form FE thu thập contactPerson/email/taxCode/category/notes nhưng
-- bảng suppliers chỉ có name/phone/address → BE đang bỏ các field này. Thêm cột
-- để lưu đầy đủ (TICKET 2).
--
-- category: lưu dạng text tự do (FE dùng union ingredient|packaging|equipment|
--           other nhưng BE KHÔNG enforce).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_person text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email          text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_code       text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category       text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes          text;
