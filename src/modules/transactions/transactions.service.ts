import { Injectable } from '@nestjs/common';
import {
  TransactionProc,
  TransactionRow,
  ExpenseRuleRow,
  ReconcilePreviewResult,
  ExpenseReconcilePreviewResult,
} from './transactions.proc';
import { Transaction, ExpenseRule } from './transactions.types';
import { ReconcilePair } from './dto/reconcile-apply.dto';
import { ExpenseReconcilePair } from './dto/expense-reconcile-apply.dto';

const toIso = (val: string | Date | null): string => {
  if (!val) return new Date().toISOString();
  return val instanceof Date ? val.toISOString() : String(val);
};

const mapRow = (r: TransactionRow): Transaction => ({
  id: r.id,
  accountNumber: r.account_number ?? '',
  accumulated: Number(r.accumulated) || 0,
  code: r.code ?? null,
  content: r.content ?? '',
  createdAt: toIso(r.created_at),
  description: r.description ?? '',
  gateway: r.gateway ?? '',
  orderNumber: r.order_number ?? '',
  receivedAt: toIso(r.received_at),
  referenceCode: r.reference_code ?? '',
  sepayId: Number(r.sepay_id) || 0,
  subAccount: r.sub_account ?? '',
  transactionDate: String(r.transaction_date ?? ''),
  transferType: r.transfer_type ?? 'in',
  transferAmount: Number(r.transfer_amount) || 0,
  isExternal: r.is_external === true,
  settledOut: r.settled_out === true,
  expenseCategory: r.expense_category ?? null,
  costExcluded: r.cost_excluded === true,
  needsReview: r.needs_review === true,
  reviewNote: r.review_note ?? null,
});

const mapRule = (r: ExpenseRuleRow): ExpenseRule => ({
  id: r.id,
  keyword: r.keyword,
  category: r.category,
});

/** Service chỉ orchestration + map; mọi call DB qua TransactionProc. */
@Injectable()
export class TransactionsService {
  constructor(private readonly proc: TransactionProc) {}

  async fetchTransactions(): Promise<Transaction[]> {
    return (await this.proc.list()).map(mapRow);
  }

  async fetchTransactionsByOrderNumber(orderNumber: string): Promise<Transaction[]> {
    return (await this.proc.listByOrder(orderNumber)).map(mapRow);
  }

  /** Giao dịch tiền RA chưa gắn phiếu hoàn nào — cho FE chọn khi đối soát hoàn. */
  async fetchOutUnlinked(): Promise<Transaction[]> {
    return (await this.proc.listOutUnlinked()).map(mapRow);
  }

  /** Đánh dấu giao dịch là không liên quan đến hệ thống (hoặc bỏ đánh dấu). */
  async markTransactionExternal(id: string, isExternal: boolean): Promise<void> {
    await this.proc.markExternal(id, isExternal);
  }

  /** Đánh dấu giao dịch tiền RA đã kết toán (chuyển về TK chính) hoặc bỏ. */
  async markTransactionSettled(id: string, settled: boolean): Promise<void> {
    await this.proc.markSettled(id, settled);
  }

  /** Liên kết giao dịch với 1 đơn (ghi orderNumber); chuỗi rỗng = gỡ liên kết. */
  async linkTransactionOrder(id: string, orderNumber: string): Promise<void> {
    await this.proc.linkOrder(id, orderNumber);
  }

  /** Set tay phân loại chi phí (category + cờ loại khỏi chi phí) cho 1 giao dịch. */
  async setTransactionExpense(id: string, category: string | null, excluded: boolean): Promise<void> {
    await this.proc.setExpense(id, category || null, excluded);
  }

  /** Danh sách rule phân loại chi phí. */
  async fetchExpenseRules(): Promise<ExpenseRule[]> {
    return (await this.proc.expenseRulesList()).map(mapRule);
  }

  /** Thay toàn bộ rule; trả list mới. */
  async saveExpenseRules(items: { keyword: string; category: string }[]): Promise<ExpenseRule[]> {
    return (await this.proc.expenseRulesSaveAll(items ?? [])).map(mapRule);
  }

  /** Auto phân loại bank-out theo rule; trả số bản ghi đã gán. */
  async applyExpenseRules(): Promise<{ classified: number }> {
    const rows = await this.proc.expenseApplyRules();
    return { classified: Number(rows[0]?.expense_apply_rules) || 0 };
  }

  /** Tổng hợp OPEX theo category trong kỳ. */
  async fetchExpenseSummary(fromIso: string, toIso: string): Promise<{ category: string; amount: number }[]> {
    const rows = await this.proc.expenseSummary(fromIso, toIso);
    const arr = rows[0]?.result ?? [];
    return arr.map((x) => ({ category: x.category, amount: Number(x.amount) || 0 }));
  }

  /** Bank-out trong kỳ (kèm phân loại) cho màn chi phí. */
  async fetchExpenseOut(fromIso: string, toIso: string): Promise<Transaction[]> {
    return (await this.proc.expenseOutList(fromIso, toIso)).map(mapRow);
  }

  /**
   * Tạo giao dịch từ webhook SePay — IDEMPOTENT theo sepayId (sepay_id).
   * Logic chống trùng nằm trong proc. Trả về cờ duplicate + transaction.
   */
  async createFromSepay(
    body: unknown,
  ): Promise<{ duplicate: boolean; transaction: Transaction }> {
    const rows = await this.proc.createFromSepay(body);
    const result = rows[0].result;
    return { duplicate: result.duplicate, transaction: mapRow(result.transaction) };
  }

  /** Đối soát: preview (dry-run) các cặp GD↔đơn sẽ khớp tự động — KHÔNG ghi. */
  async reconcilePreview(): Promise<ReconcilePreviewResult> {
    const rows = await this.proc.reconcilePreview();
    const r = rows[0].result;
    return {
      ...r,
      matched: (r.matched ?? []).map((m) => ({
        ...m,
        sepayId: Number(m.sepayId) || 0,
        amount: Number(m.amount) || 0,
      })),
    };
  }

  /** Đối soát: ghi map cho danh sách cặp đã user confirm (atomic, idempotent). */
  async reconcileApply(
    pairs: ReconcilePair[],
  ): Promise<{ applied: number; skipped: number }> {
    const rows = await this.proc.reconcileApply(pairs ?? []);
    return rows[0].result;
  }

  /** Đối soát CHI PHÍ: preview cặp tiền-ra ↔ chi phí tay. */
  async expenseReconcilePreview(): Promise<ExpenseReconcilePreviewResult> {
    const rows = await this.proc.expenseReconcilePreview();
    const r = rows[0].result;
    return {
      ...r,
      matched: (r.matched ?? []).map((m) => ({
        ...m,
        amount: Number(m.amount) || 0,
      })),
    };
  }

  /** Đối soát CHI PHÍ: gắn cho danh sách cặp đã confirm (atomic, idempotent). */
  async expenseReconcileApply(
    pairs: ExpenseReconcilePair[],
  ): Promise<{ applied: number; skipped: number }> {
    const rows = await this.proc.expenseReconcileApply(pairs ?? []);
    return rows[0].result;
  }

  /** Khớp tay 1 GD tiền-ra với 1 khoản chi phí có sẵn. Trả true nếu gắn được. */
  async expenseLink(txId: string, expenseId: string): Promise<{ ok: boolean }> {
    const rows = (await this.proc.expenseLink(txId, expenseId)) as unknown[];
    return { ok: Array.isArray(rows) && rows.length > 0 };
  }

  /** Bỏ khớp khoản chi khỏi 1 GD tiền-ra. Trả số khoản đã bỏ gắn. */
  async expenseUnlink(txId: string): Promise<{ unlinked: number }> {
    const rows = await this.proc.expenseUnlink(txId);
    return { unlinked: Number(rows[0]?.expense_out_unlink) || 0 };
  }
}
