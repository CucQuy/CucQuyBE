-- ============================================================
-- 105 — Gộp 'owner' (rút vốn/rút lời) + 'internal' (nội bộ/nạp ví) vào 'personal'.
-- Cả 3 đều KHÔNG tính vào P&L nên chia nhỏ không đổi được con số nào, chỉ làm
-- màn đối soát nhiều nút hơn và người dùng phải phân vân chọn cái nào.
-- FE cũng bỏ 2 lựa chọn này khỏi dropdown (chỉ còn "Cá nhân (không tính)").
--
-- 126 giao dịch bị đổi (117 owner + 9 internal). Rollback: chạy file
-- info/db-dumps/merge_personal_rollback_20260920.sql (gitignored, ngoài repo).
--
-- KHÔNG đụng expense_category_is_cost / transaction_ledger_status: 2 hàm đó vẫn
-- liệt kê 'owner'/'internal' để dữ liệu nhập tay cũ (nếu có) vẫn ra đúng nhóm.
-- ============================================================

UPDATE transactions
   SET expense_category = 'personal'
 WHERE expense_category IN ('owner', 'internal');

-- Rule từ khoá (nếu có rule nào còn gán 2 category cũ).
UPDATE expense_rules
   SET category = 'personal'
 WHERE category IN ('owner', 'internal');

-- Chi phí nhập tay (manual_expenses) — hiện không dùng 2 category này, để cho chắc.
UPDATE manual_expenses
   SET category = 'personal'
 WHERE category IN ('owner', 'internal');
