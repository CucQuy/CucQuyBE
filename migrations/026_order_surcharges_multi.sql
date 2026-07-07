-- ============================================================
-- Phụ thu nhiều dòng: mỗi nhãn 1 số tiền riêng.
-- Thêm cột surcharges jsonb = [{tag, amount}]. Giữ surcharge_amount = TỔNG (sum) cho
-- total/doanh thu (không đổi logic tính tiền), surcharge_tag = nhãn dòng đầu (legacy).
-- Backfill đơn cũ: nếu có surcharge_amount > 0 → dựng 1 dòng {tag, amount}.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS surcharges jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE orders
SET surcharges = jsonb_build_array(
      jsonb_build_object('tag', surcharge_tag, 'amount', surcharge_amount)
    )
WHERE COALESCE(surcharge_amount, 0) > 0
  AND (surcharges IS NULL OR surcharges = '[]'::jsonb);
