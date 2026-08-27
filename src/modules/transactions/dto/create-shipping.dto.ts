import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** Gắn thanh toán ship cho 1 GD tiền ra: chọn đơn hoặc nhà xe (ít nhất 1 — validate ở stored function). */
export class CreateShippingDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
