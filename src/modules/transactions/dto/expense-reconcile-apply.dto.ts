import { IsArray } from 'class-validator';

/** 1 cặp GD tiền-ra ↔ chi phí tay user đã duyệt ở preview đối soát chi phí. */
export interface ExpenseReconcilePair {
  transactionId: string;
  expenseId: string;
}

export class ExpenseReconcileApplyDto {
  /** Danh sách cặp cần gắn (lấy từ preview, user đã xác nhận). */
  @IsArray()
  pairs!: ExpenseReconcilePair[];
}
