import { IsNumber, Min } from 'class-validator';

/**
 * Payload PUT /configurations/payment-accounts/:id/opening (102).
 * amount = số dư đang thấy trên app ngân hàng; BE đóng mốc thời gian = now().
 */
export class SetPaymentAccountOpeningDto {
  @IsNumber()
  @Min(0)
  amount!: number;
}
