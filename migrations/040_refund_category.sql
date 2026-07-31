-- ============================================================
-- 040 — Hạng mục hoàn tiền (order_refunds.category) + hoàn tiền TAY theo hạng mục.
--
-- Bối cảnh: đối soát tiền RA cần hoàn tiền cho đơn theo LÝ DO có cấu trúc, vd:
--   • đã cọc mà SPX vẫn thu COD → thu hộ trùng, phải hoàn (overcollected_cod)
--   • KH đổi từ ship sang tới lấy → hoàn phí ship (ship_refund)
--   • huỷ đơn (cancel), giảm số lượng (reduce_qty, tự sinh #179), khác (other)
--
-- Thêm cột category vào order_refunds. Backfill phiếu tự sinh (có items) = reduce_qty.
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS category text;

-- Phiếu hoàn tự sinh trước đây (giảm SL nên có items) → gán hạng mục reduce_qty.
UPDATE order_refunds
   SET category = 'reduce_qty'
 WHERE category IS NULL
   AND COALESCE(jsonb_array_length(items), 0) > 0;
