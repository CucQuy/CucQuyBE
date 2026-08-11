-- Mốc in bill cho khách gần nhất — để FE đánh dấu/badge "đã in bill" (null = chưa in).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_printed_at timestamptz;
