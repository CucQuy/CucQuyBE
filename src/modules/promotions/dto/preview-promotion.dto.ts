import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** Body cho POST /promotions/preview — giỏ hàng + mã (nếu có). */
export class PreviewPromotionDto {
  @IsArray()
  items!: { productId?: string; price: number; quantity: number }[];

  @IsOptional()
  @IsArray()
  decorations?: { price: number; quantity: number }[];

  /** Phụ thu tổng cho cả đơn (VND) — cộng vào subtotal TRƯỚC giảm giá. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  surchargeAmount?: number;

  /** Nhãn loại phụ thu: 'decoration' | 'theme' | 'accessory'. */
  @IsOptional()
  @IsString()
  surchargeTag?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsArray()
  promotionIds?: string[];
}
