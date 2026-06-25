import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Payload PUT /configurations/payment. */
export class SavePaymentDto {
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
