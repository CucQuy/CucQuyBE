-- ============================================================
-- 008: Cọc tiền (deposit) cho đơn hàng.
--   deposit_amount = số tiền cọc thoả thuận (VND).
--   paid_amount    = đã nhận thực tế (cọc + trả thêm, webhook cộng dồn).
--   payment_status: thêm giá trị 'DEPOSITED' (cột text — không cần ALTER enum).
--     suy ra từ paid_amount: 0→UNPAID, 0<paid<total→DEPOSITED, ≥total→PAID.
-- Additive, an toàn: đơn cũ deposit=0/paid=0; đơn PAID cũ backfill paid=total.
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount    numeric NOT NULL DEFAULT 0;

-- Backfill: đơn đã PAID trước đây → coi như đã trả đủ (nhất quán với status suy ra).
UPDATE orders
   SET paid_amount = COALESCE(total, 0)
 WHERE payment_status = 'PAID' AND COALESCE(paid_amount, 0) = 0;
