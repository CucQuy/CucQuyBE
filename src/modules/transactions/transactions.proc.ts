import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Dòng trả về từ transaction_* (snake_case khớp cột bảng). */
export type TransactionRow = {
  id: string;
  sepay_id: string | number | null;
  gateway: string | null;
  transaction_date: string | null;
  account_number: string | null;
  code: string | null;
  content: string | null;
  transfer_type: string | null;
  transfer_amount: string | number | null;
  accumulated: string | number | null;
  sub_account: string | null;
  reference_code: string | null;
  description: string | null;
  order_number: string | null;
  is_external: boolean | null;
  settled_out: boolean | null;
  expense_category: string | null;
  cost_excluded: boolean | null;
  needs_review: boolean | null;
  review_note: string | null;
  received_at: string | Date | null;
  created_at: string | Date | null;
};

/** Rule phân loại chi phí (nội dung CK → category). */
export type ExpenseRuleRow = {
  id: string;
  keyword: string;
  category: string;
  created_at: string | Date | null;
};

/**
 * Tầng quản lý stored procedure của domain transactions.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class TransactionProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<TransactionRow[]> {
    return this.db.sql<TransactionRow[]>`SELECT * FROM transaction_list()`;
  }

  listByOrder(orderNumber: string): Promise<TransactionRow[]> {
    return this.db
      .sql<TransactionRow[]>`SELECT * FROM transaction_list_by_order(${orderNumber})`;
  }

  /** Giao dịch tiền RA chưa gắn phiếu hoàn nào (cho FE chọn khi đối soát). */
  listOutUnlinked(): Promise<TransactionRow[]> {
    return this.db
      .sql<TransactionRow[]>`SELECT * FROM transaction_list_out_unlinked()`;
  }

  markExternal(id: string, isExternal: boolean): Promise<unknown> {
    return this.db.sql`SELECT * FROM transaction_mark_external(${id}, ${isExternal})`;
  }

  markSettled(id: string, settled: boolean): Promise<unknown> {
    return this.db.sql`SELECT * FROM transaction_mark_settled(${id}, ${settled})`;
  }

  /** Set tay phân loại chi phí cho 1 giao dịch (category + cờ loại khỏi chi phí). */
  setExpense(id: string, category: string | null, excluded: boolean): Promise<unknown> {
    return this.db.sql`SELECT * FROM transaction_set_expense(${id}, ${category}, ${excluded})`;
  }

  /** Danh sách rule phân loại chi phí. */
  expenseRulesList(): Promise<ExpenseRuleRow[]> {
    return this.db.sql<ExpenseRuleRow[]>`SELECT * FROM expense_rules_list()`;
  }

  /** Thay toàn bộ danh sách rule (client gửi đủ list). */
  expenseRulesSaveAll(items: unknown): Promise<ExpenseRuleRow[]> {
    return this.db
      .sql<ExpenseRuleRow[]>`SELECT * FROM expense_rules_save_all(${this.db.json(items ?? [])}::jsonb)`;
  }

  /** Auto phân loại bank-out theo rule; trả số bản ghi đã gán. */
  expenseApplyRules(): Promise<{ expense_apply_rules: number }[]> {
    return this.db
      .sql<{ expense_apply_rules: number }[]>`SELECT expense_apply_rules()`;
  }

  /** Tổng hợp OPEX theo category trong kỳ (jsonb array). */
  expenseSummary(fromIso: string, toIso: string): Promise<{ result: { category: string; amount: number | string }[] }[]> {
    return this.db.sql<{ result: { category: string; amount: number | string }[] }[]>`
      SELECT expense_summary(${fromIso}, ${toIso}) AS result`;
  }

  /** Bank-out trong kỳ (kèm phân loại) cho màn chi phí. */
  expenseOutList(fromIso: string, toIso: string): Promise<TransactionRow[]> {
    return this.db.sql<TransactionRow[]>`SELECT * FROM expense_out_list(${fromIso}, ${toIso})`;
  }

  linkOrder(id: string, orderNumber: string): Promise<unknown> {
    return this.db.sql`SELECT * FROM transaction_link_order(${id}, ${orderNumber})`;
  }

  createFromSepay(
    body: unknown,
  ): Promise<{ result: { duplicate: boolean; transaction: TransactionRow } }[]> {
    return this.db.sql<{ result: { duplicate: boolean; transaction: TransactionRow } }[]>`
      SELECT transaction_create_from_sepay(${this.db.json(body ?? {})}::jsonb) AS result`;
  }

  /** Đối soát: preview (dry-run) các cặp GD↔đơn sẽ khớp tự động. */
  reconcilePreview(): Promise<{ result: ReconcilePreviewResult }[]> {
    return this.db.sql<{ result: ReconcilePreviewResult }[]>`
      SELECT transaction_reconcile_preview() AS result`;
  }

  /** Đối soát: ghi map cho danh sách cặp đã confirm (atomic, idempotent). */
  reconcileApply(
    pairs: unknown,
  ): Promise<{ result: { applied: number; skipped: number } }[]> {
    return this.db.sql<{ result: { applied: number; skipped: number } }[]>`
      SELECT transaction_reconcile_apply(${this.db.json(pairs ?? [])}::jsonb) AS result`;
  }

  /** Đối soát CHI PHÍ: preview cặp tiền-ra ↔ chi phí tay (số tiền + gần ngày). */
  expenseReconcilePreview(): Promise<{ result: ExpenseReconcilePreviewResult }[]> {
    return this.db.sql<{ result: ExpenseReconcilePreviewResult }[]>`
      SELECT expense_out_reconcile_preview(3) AS result`;
  }

  /** Đối soát CHI PHÍ: gắn transaction_id cho từng khoản chi (atomic, idempotent). */
  expenseReconcileApply(
    pairs: unknown,
  ): Promise<{ result: { applied: number; skipped: number } }[]> {
    return this.db.sql<{ result: { applied: number; skipped: number } }[]>`
      SELECT expense_out_reconcile_apply(${this.db.json(pairs ?? [])}::jsonb) AS result`;
  }

  /** Khớp tay 1 GD tiền-ra với 1 khoản chi phí có sẵn. */
  expenseLink(txId: string, expenseId: string): Promise<unknown> {
    return this.db.sql`SELECT * FROM expense_out_link(${txId}, ${expenseId}::uuid)`;
  }

  /** Bỏ khớp khoản chi khỏi 1 GD tiền-ra. */
  expenseUnlink(txId: string): Promise<{ expense_out_unlink: number }[]> {
    return this.db.sql<{ expense_out_unlink: number }[]>`SELECT expense_out_unlink(${txId})`;
  }
}

/** 1 cặp GD↔đơn khớp tự động (từ preview). */
export type ReconcileMatch = {
  transactionId: string;
  sepayId: number | string | null;
  orderId: string;
  orderNumber: string;
  amount: number | string;
  transactionDate: string;
  orderCreatedAt: string;
};

export type ReconcilePreviewResult = {
  matched: ReconcileMatch[];
  skippedAmbiguous: number;
  skippedNoMatch: number;
  totalUnmatched: number;
};

/** 1 cặp GD tiền-ra ↔ chi phí tay khớp tự động (từ preview đối soát chi phí). */
export type ExpenseReconcileMatch = {
  transactionId: string;
  expenseId: string;
  amount: number | string;
  transactionDate: string;
  expenseDate: string;
  category: string | null;
  note: string | null;
  description: string | null;
};

export type ExpenseReconcilePreviewResult = {
  matched: ExpenseReconcileMatch[];
  skippedAmbiguous: number;
  skippedNoMatch: number;
  totalUnlinkedTx: number;
  totalUnlinkedExpense: number;
};
