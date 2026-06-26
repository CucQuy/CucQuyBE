import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Payload POST /configurations/payment-accounts (tạo tài khoản nhận tiền). */
export class CreatePaymentAccountDto {
  @IsString()
  @IsNotEmpty()
  bankCode!: string;

  @IsString()
  @IsNotEmpty()
  accountNumber!: string;

  @IsString()
  @IsNotEmpty()
  accountHolder!: string;

  @IsString()
  @IsOptional()
  qrTemplate?: string;
}
