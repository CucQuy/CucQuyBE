-- 012: Tài sản / CSVC (CAPEX) — khấu hao phân bổ theo tháng vào chi phí/lợi nhuận.
-- Khấu hao tháng = cost / useful_months; phân bổ vào các tháng [start_date .. +useful_months).
-- revenue.sql cộng phần khấu hao rơi trong kỳ vào tổng chi phí.

CREATE TABLE IF NOT EXISTS assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  cost          numeric NOT NULL CHECK (cost >= 0),   -- VND (nguyên giá)
  useful_months integer NOT NULL CHECK (useful_months >= 1), -- số tháng khấu hao
  start_date    date NOT NULL,                        -- bắt đầu khấu hao
  category      text,                                 -- vd equipment|furniture|renovation|other
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
