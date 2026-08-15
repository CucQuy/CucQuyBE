-- ============================================================
-- Cho phép "đánh dấu đã khớp DÙ LỆCH" cho phiếu nhập (bill).
-- Trước đây bill chỉ reconciled khi tổng GD đã gắn >= total_amount.
-- Nay user có thể gán nhiều GD chưa khớp 100% rồi chủ động đánh dấu đã khớp;
-- phần lệch chỉ cảnh báo, không chặn. Cờ này giữ trạng thái đó qua mỗi lần recompute.
-- (recompute tự gỡ cờ về false khi bill không còn phân bổ nào — xem receipt_allocations.sql)
-- ============================================================
ALTER TABLE stock_receipts
  ADD COLUMN IF NOT EXISTS reconcile_forced boolean NOT NULL DEFAULT false;
