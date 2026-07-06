-- 013: Bật pg_trgm để gợi ý gộp nguyên liệu trùng (Phase 1).
-- Idempotent: chạy lại nhiều lần không lỗi.
-- Lưu ý: migration đánh số KHÔNG tự chạy khi deploy — orchestrator apply tay.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_materials_norm_trgm
  ON materials USING gin (normalized_name gin_trgm_ops);
