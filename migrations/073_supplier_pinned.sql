-- Ghim nhà cung cấp (NCC hay gọi ship → ghim lên đầu danh bạ).
-- Additive, idempotent: cột boolean mặc định false.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_suppliers_pinned ON suppliers(pinned) WHERE pinned;
