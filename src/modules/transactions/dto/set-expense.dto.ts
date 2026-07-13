import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SetExpenseDto {
  /** Category chi phí (rỗng/null = bỏ phân loại). */
  @IsOptional()
  @IsString()
  category?: string | null;

  /** Loại khỏi chi phí (nội bộ / trả NCC đã tính COGS...). */
  @IsBoolean()
  excluded!: boolean;
}
