import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

/** Query params lọc + phân trang cho GET /request-logs. */
export class QueryLogsDto {
  @ApiPropertyOptional({ description: 'Từ thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Đến thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'HTTP method (GET/POST/...)' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ description: 'HTTP status code', example: 200 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  status?: number;

  @ApiPropertyOptional({ description: 'Lọc theo uid người dùng' })
  @IsOptional()
  @IsString()
  uid?: string;

  @ApiPropertyOptional({ description: 'Lọc theo email người dùng' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Lọc theo địa chỉ IP' })
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional({ description: 'Trang (1-based)', default: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Số dòng/trang (tối đa 200)', default: 50 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Query params cho GET /request-logs/stats. */
export class StatsLogsDto {
  @ApiPropertyOptional({ description: 'Từ thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Đến thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Chỉ tính request lỗi (status ≥ 400)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  errorsOnly?: boolean;
}

/** Query params cho GET /request-logs/timeseries. */
export class TimeseriesLogsDto {
  @ApiPropertyOptional({ description: 'Từ thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Đến thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: "Gom theo 'hour' hoặc 'day'", default: 'day' })
  @IsOptional()
  @IsIn(['hour', 'day'])
  bucket?: 'hour' | 'day';

  @ApiPropertyOptional({ description: 'Chỉ tính request lỗi (status ≥ 400)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  errorsOnly?: boolean;
}

/** Query params cho GET /request-logs/error-groups. */
export class ErrorGroupsDto {
  @ApiPropertyOptional({ description: 'Từ thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Đến thời điểm (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Số nhóm tối đa', default: 50 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
