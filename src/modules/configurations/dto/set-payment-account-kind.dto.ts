import { IsIn } from 'class-validator';

/**
 * Payload PUT /configurations/payment-accounts/:id/kind (100).
 * hkd = TK hộ kinh doanh (nhận tiền khách, QR đơn) · personal = TK cá nhân (chi hoá đơn).
 */
export class SetPaymentAccountKindDto {
  @IsIn(['hkd', 'personal'])
  kind!: 'hkd' | 'personal';
}
