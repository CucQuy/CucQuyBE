import { IsArray, IsOptional, IsString } from 'class-validator';

/** 1 cặp GD tiền VÀO ↔ đơn hàng. */
export interface AutoReconcileInOrder {
  transactionId: string;
  orderId: string;
  orderNumber: string;
  sepayId: number | string;
}

/** 1 cặp GD tiền RA ↔ phiếu nhập kho. `amount` = toàn bộ tiền GD (rải trọn 1 phiếu). */
export interface AutoReconcileOutReceipt {
  transactionId: string;
  receiptId: string;
  amount: number | string;
}

/** 1 cặp GD tiền RA ↔ khoản chi nhập tay. */
export interface AutoReconcileOutExpense {
  transactionId: string;
  expenseId: string;
}

/** Khoảng ngày quét — lấy đúng bộ lọc đang chọn trên màn Sổ giao dịch. */
export class AutoReconcilePreviewDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

/**
 * Các cặp người dùng CÒN TICK ở modal preview. Ba nhóm rời nhau — bỏ trống nhóm nào
 * thì nhóm đó không ghi gì.
 */
export class AutoReconcileApplyDto {
  @IsOptional()
  @IsArray()
  inOrders?: AutoReconcileInOrder[];

  @IsOptional()
  @IsArray()
  outReceipts?: AutoReconcileOutReceipt[];

  @IsOptional()
  @IsArray()
  outExpenses?: AutoReconcileOutExpense[];
}
