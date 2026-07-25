import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertManualExpenseDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  date!: string; // yyyy-mm-dd

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  category!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  spreadMonths?: number;

  @IsOptional()
  @IsString()
  note?: string;

  /** Gắn khoản chi này với 1 GD tiền-ra (đối soát chi phí). Rỗng = không gắn. */
  @IsOptional()
  @IsString()
  transactionId?: string | null;
}
