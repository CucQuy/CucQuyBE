import { IsString } from 'class-validator';

/** Body khi đối soát 1 giao dịch (tiền vào/ra) với 1 đơn ngay từ form đơn. */
export class ReconcileTransactionDto {
  /** id giao dịch SePay để đối ứng (in → cộng, out → trừ paidAmount). */
  @IsString()
  transactionId!: string;
}
