import { IsArray } from 'class-validator';

/** 1 cặp phiếu-nhập ↔ GD tiền-ra user đã duyệt ở preview đối soát phiếu nhập. */
export interface ReceiptReconcilePair {
  receiptId: string;
  transactionId: string;
}

export class ReceiptReconcileApplyDto {
  /** Danh sách cặp cần gắn (lấy từ preview / khớp tay, user đã xác nhận). */
  @IsArray()
  pairs!: ReceiptReconcilePair[];
}
