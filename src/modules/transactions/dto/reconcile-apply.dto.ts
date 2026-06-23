import { IsArray } from 'class-validator';

/** 1 cặp GD↔đơn đã được user duyệt ở bước preview. */
export interface ReconcilePair {
  transactionId: string;
  orderId: string;
  orderNumber: string;
  sepayId: number | string;
}

export class ReconcileApplyDto {
  /** Danh sách cặp cần ghi map (lấy từ preview, user đã xác nhận). */
  @IsArray()
  pairs!: ReconcilePair[];
}
