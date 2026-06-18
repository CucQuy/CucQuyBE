import { Injectable } from '@nestjs/common';
import { TransactionProc, TransactionRow } from './transactions.proc';
import { Transaction } from './transactions.types';

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

  /** Đánh dấu giao dịch là không liên quan đến hệ thống (hoặc bỏ đánh dấu). */
  async markTransactionExternal(id: string, isExternal: boolean): Promise<void> {
    await this.proc.markExternal(id, isExternal);
  }

  /** Liên kết giao dịch với 1 đơn (ghi orderNumber); chuỗi rỗng = gỡ liên kết. */
  async linkTransactionOrder(id: string, orderNumber: string): Promise<void> {
    await this.proc.linkOrder(id, orderNumber);
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
}
