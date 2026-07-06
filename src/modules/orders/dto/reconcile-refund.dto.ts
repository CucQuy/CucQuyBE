import { IsString } from 'class-validator';

/** Body khi đối soát 1 phiếu hoàn với 1 giao dịch SePay tiền ra. */
export class ReconcileRefundDto {
  /** id giao dịch SePay (transfer_type='out') để gắn vào phiếu hoàn. */
  @IsString()
  transactionId!: string;
}
