-- Khuyến mãi có thể chạy NHIỀU đợt: mỗi lần "mở lại" cất đợt hiện tại (kỳ + lượt) vào
-- lịch sử `runs`, rồi reset used_count = 0 và đặt kỳ mới. Số lần chạy = len(runs) + 1 (đợt live).
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS runs jsonb NOT NULL DEFAULT '[]'::jsonb;
