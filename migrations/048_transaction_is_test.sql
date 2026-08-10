-- ============================================================
-- Giao dịch TEST: tiền vào tài khoản test (MBBank 0776750418) → is_test=true.
-- Dùng để test thông luồng thanh toán (QR → webhook → order:paid → loa) mà
-- KHÔNG làm bẩn doanh thu/đối soát thật (các query đã lọc COALESCE(is_test,false)=false).
-- ============================================================
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_transactions_is_test ON transactions (is_test) WHERE is_test;
