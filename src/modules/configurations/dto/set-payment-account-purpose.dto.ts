import { IsIn } from 'class-validator';

/**
 * Payload PUT /configurations/payment-accounts/:id/purpose (099).
 * receive = TK nhận tiền khách (QR đơn) · spend = TK chi hoá đơn (nhận tiền dồn cuối ngày).
 */
export class SetPaymentAccountPurposeDto {
  @IsIn(['receive', 'spend'])
  purpose!: 'receive' | 'spend';
}
