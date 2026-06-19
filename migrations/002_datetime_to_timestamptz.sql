-- ============================================================
-- 002 — Đồng bộ datetime: ALTER 7 cột text (chứa ISO) → timestamptz (epic #9)
-- Audit (#10) xác nhận prod+staging 100% giá trị là ISO `...Z`, 0 firebase_object,
-- 0 row fail cast → ALTER USING ::timestamptz an toàn. NULLIF rỗng → NULL.
-- Read functions trả SETOF/jsonb → tự thích ứng; writes ISO-text → implicit cast.
-- KHÔNG đụng nhóm B (date-only/giờ/string thuần): orders.delivery_date/time,
-- stock_receipts.receipt_date/time, transactions.transaction_date, facebook_messages.source_created_at.
-- Idempotent: chỉ ALTER khi cột còn là text.
-- ============================================================
DO $$
DECLARE
  r record;
  cols text[][] := ARRAY[
    ['users','last_login_at'], ['users','created_at'],
    ['suppliers','last_receipt_date'], ['materials','last_receipt_date'],
    ['promotions','created_at'], ['promotions','updated_at'],
    ['promotions','start_at'], ['promotions','end_at'],
    ['orders','commission_paid_at']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(cols,1) LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=cols[i][1]
        AND column_name=cols[i][2] AND data_type='text'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING NULLIF(%I, %L)::timestamptz',
        cols[i][1], cols[i][2], cols[i][2], ''
      );
      RAISE NOTICE 'ALTERed %.% -> timestamptz', cols[i][1], cols[i][2];
    ELSE
      RAISE NOTICE 'skip %.% (không phải text/đã đổi)', cols[i][1], cols[i][2];
    END IF;
  END LOOP;
END $$;
