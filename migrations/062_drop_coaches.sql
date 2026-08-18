-- Gỡ tính năng Nhà xe / Ship xe khách (coaches): xoá danh bạ + stored functions.
-- Cột orders.coach_info được GIỮ dormant (0 đơn dùng, order functions đã bỏ tham
-- chiếu) để tránh rủi ro drop cột trong lúc rollout (order functions re-apply sau
-- bước migration). Không ảnh hưởng gì; có thể drop sau nếu cần.
DROP FUNCTION IF EXISTS coaches_save_all(jsonb);
DROP FUNCTION IF EXISTS coaches_get();
DROP TABLE IF EXISTS coaches;
