import { IsBoolean } from 'class-validator';

/** Payload PUT /configurations/payment-accounts/:id/tracked (bật/tắt đưa vào sổ đối soát). */
export class SetPaymentAccountTrackedDto {
  @IsBoolean()
  tracked!: boolean;
}
