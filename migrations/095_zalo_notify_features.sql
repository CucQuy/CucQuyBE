-- Gán TÍNH NĂNG thông báo cho từng nhóm Zalo.
--
-- Trước: 4 cột boolean (notify_on_create/update/delete/payment) + 2 cột "nhóm mặc định"
-- trên zalo_config (main_group_id, payment_group_id). Hệ quả: 8 loại thông báo khác
-- (đơn chưa TT, đơn chờ xử lý, đơn cần giao, sản xuất mai, đơn treo, tổng kết ngày,
-- tin tuỳ chỉnh, health check) không gán được nhóm — tất cả dồn vào main_group_id.
--
-- Sau: 1 mảng zalo_groups.notify_features — thêm loại thông báo mới KHÔNG cần thêm cột.
-- Cột cũ giữ lại (chưa DROP) để rollback được; code không đọc nữa.
ALTER TABLE zalo_groups
  ADD COLUMN IF NOT EXISTS notify_features text[] NOT NULL DEFAULT '{}'::text[];

-- Backfill 1 lần: cột boolean cũ → feature key; nhóm đang là main_group_id nhận trọn
-- các loại vốn gửi vào "nhóm chính"; nhóm đang là payment_group_id nhận 'payment'.
UPDATE zalo_groups g
   SET notify_features = (
     SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
       FROM (
         SELECT 'order_create'  AS f WHERE g.notify_on_create IS DISTINCT FROM false
         UNION ALL SELECT 'order_update'  WHERE g.notify_on_update IS DISTINCT FROM false
         UNION ALL SELECT 'order_delete'  WHERE g.notify_on_delete IS DISTINCT FROM false
         UNION ALL SELECT 'payment'       WHERE g.notify_on_payment IS TRUE
         UNION ALL SELECT 'payment'
           WHERE COALESCE(g.zalo_group_id, '') <> ''
             AND g.zalo_group_id = (SELECT payment_group_id FROM zalo_config WHERE id = 'zalo')
         UNION ALL SELECT x
           FROM unnest(ARRAY[
                  'unpaid', 'pending', 'delivery_due', 'production_tomorrow',
                  'stuck_pending', 'daily_summary', 'custom', 'health_check'
                ]) AS x
          WHERE COALESCE(g.zalo_group_id, '') <> ''
            AND g.zalo_group_id = (SELECT main_group_id FROM zalo_config WHERE id = 'zalo')
       ) s
   )
 WHERE notify_features = '{}'::text[];

-- Nhóm nào tra theo feature cũng chỉ cần lọc mảng → index GIN cho chắc.
CREATE INDEX IF NOT EXISTS zalo_groups_notify_features_idx
  ON zalo_groups USING GIN (notify_features);
