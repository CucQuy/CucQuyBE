import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** Body khi tạo phiếu hoàn TAY theo hạng mục cho 1 đơn (đối soát tiền ra). */
export class CreateRefundDto {
  /** Số tiền hoàn (VND) — bắt buộc > 0. */
  @IsNumber()
  @Min(1)
  amount!: number;

  /** Hạng mục hoàn: overcollected_cod | ship_refund | cancel | other… */
  @IsOptional()
  @IsString()
  category?: string;

  /** Ghi chú lý do (tuỳ chọn). */
  @IsOptional()
  @IsString()
  reason?: string;

  /** id giao dịch SePay tiền ra để gắn + đối soát luôn (tuỳ chọn). */
  @IsOptional()
  @IsString()
  transactionId?: string;
}
