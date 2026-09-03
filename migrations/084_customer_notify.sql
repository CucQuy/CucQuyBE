-- Thông báo Zalo cho KHÁCH HÀNG (cảm ơn đặt hàng + link tra trạng thái + mã KM).
-- Khác với noti nội bộ (gửi vào nhóm) — đây là tin CÁ NHÂN gửi tới SĐT khách trên đơn.
--   orders.public_token         : token link tra cứu đơn công khai (/don/<token>), sinh lazy lúc gửi.
--   orders.customer_notified_at : đã gửi cho khách lúc nào → chống gửi trùng (nút tay có force).
--   customers.notify_opt_out    : khách không muốn nhận tin → auto bỏ qua.
--   zalo_config.customer_notify_*: bật/tắt, chiến dịch KM chèn vào tin, hạn mức tin/ngày
--                                  (bridge Abit giới hạn tin cho người lạ → phải chặn trần).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS public_token         text,
  ADD COLUMN IF NOT EXISTS customer_notified_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_token
  ON orders (public_token) WHERE public_token IS NOT NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS notify_opt_out boolean NOT NULL DEFAULT false;

ALTER TABLE zalo_config
  ADD COLUMN IF NOT EXISTS customer_notify_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_notify_promotion_id text,
  ADD COLUMN IF NOT EXISTS customer_notify_daily_limit  int NOT NULL DEFAULT 40;
