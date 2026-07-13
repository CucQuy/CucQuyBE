import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertAssetDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  cost!: number;

  @IsInt()
  @Min(1)
  usefulMonths!: number;

  @IsString()
  startDate!: string; // yyyy-mm-dd

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
