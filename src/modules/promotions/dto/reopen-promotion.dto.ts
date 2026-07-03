import { IsOptional, IsString } from 'class-validator';

/** Mở lại khuyến mãi chạy đợt mới — đặt kỳ mới (ISO). Bỏ trống = không giới hạn đầu đó. */
export class ReopenPromotionDto {
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() endAt?: string;
}
