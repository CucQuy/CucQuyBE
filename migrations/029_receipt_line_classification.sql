-- 029: Phân loại dòng phiếu nhập thành 3 nhánh — NVL / Tài sản / Vận hành (OPEX).
-- Phiếu nhập trở thành input chung; mỗi dòng định tuyến về đúng danh mục + đúng cách
-- tính chi phí (NVL→nhập kho, Tài sản→khấu hao, Vận hành→OPEX). AI gợi ý, người xác nhận.

-- Dòng phiếu: loại + liên kết record được tạo + vết gợi ý AI.
ALTER TABLE stock_receipt_lines ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'material'; -- 'material'|'asset'|'opex'
ALTER TABLE stock_receipt_lines ADD COLUMN IF NOT EXISTS asset_id text;          -- assets.id (nếu asset)
ALTER TABLE stock_receipt_lines ADD COLUMN IF NOT EXISTS expense_id text;        -- manual_expenses.id (nếu opex)
ALTER TABLE stock_receipt_lines ADD COLUMN IF NOT EXISTS ai_suggested_type text; -- AI gợi ý ban đầu
ALTER TABLE stock_receipt_lines ADD COLUMN IF NOT EXISTS ai_confidence numeric;  -- 0..1

-- Tài sản: nguồn (tay/phiếu) + trace về dòng phiếu + NCC.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'; -- 'manual'|'receipt'
ALTER TABLE assets ADD COLUMN IF NOT EXISTS receipt_line_id text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS supplier_id text;

-- Chi phí vận hành: nguồn (tay/phiếu) + trace về dòng phiếu.
ALTER TABLE manual_expenses ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE manual_expenses ADD COLUMN IF NOT EXISTS receipt_line_id text;

CREATE INDEX IF NOT EXISTS idx_srl_item_type ON stock_receipt_lines(item_type);
