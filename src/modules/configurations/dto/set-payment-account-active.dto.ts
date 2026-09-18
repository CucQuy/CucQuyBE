import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Payload PUT /configurations/payment-accounts/:id/active.
 * active = true (mặc định) bật TK này làm TK đang dùng của loại đó (TK cùng loại tự tắt);
 * false = tắt, loại đó tạm thời không có TK đang dùng.
 */
export class SetPaymentAccountActiveDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
