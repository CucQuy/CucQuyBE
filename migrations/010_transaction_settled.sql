-- ============================================================
-- 010 — Đánh dấu giao dịch tiền RA đã "KẾT TOÁN" (chuyển về tài khoản chính).
--
-- Bối cảnh: TK của tiệm chỉ là nơi NHẬN tiền; định kỳ tiền được chuyển về tài
-- khoản chính của hệ thống. Giao dịch tiền ra loại này KHÔNG phải hoàn tiền,
-- KHÔNG gắn phiếu nào — chỉ cần 1 cờ "đã kết toán đi".
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS settled_out boolean NOT NULL DEFAULT false;
