import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  ApplyMode,
  DiscountType,
  PromotionScope,
  PromotionStatus,
} from '../promotions.types';

const APPLY_MODES: ApplyMode[] = ['CODE', 'AUTO'];
const DISCOUNT_TYPES: DiscountType[] = [
  'PERCENT',
  'FIXED',
  'FREE_SHIP',
  'BUY_X_GET_Y',
];
const SCOPES: PromotionScope[] = ['ALL', 'PRODUCTS', 'CATEGORIES'];
const STATUSES: PromotionStatus[] = ['active', 'inactive'];

export class CreatePromotionDto {
  @IsString()
  name!: string;

  @IsIn(APPLY_MODES)
  applyMode!: ApplyMode;

  @IsOptional()
  @IsString()
  code?: string;

  @IsIn(DISCOUNT_TYPES)
  discountType!: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number;

  // BUY_X_GET_Y theo nhóm (badge)
  @IsOptional()
  @IsString()
  groupBadgeId?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  buyQuantity?: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  getQuantity?: number;
  // legacy (không dùng)
  @IsOptional()
  @IsArray()
  buyProductIds?: string[];
  @IsOptional()
  @IsString()
  getProductId?: string;

  // Điều kiện
  @IsOptional()
  @IsString()
  startAt?: string;
  @IsOptional()
  @IsString()
  endAt?: string;
  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  @IsIn(SCOPES)
  scope!: PromotionScope;
  @IsOptional()
  @IsArray()
  productIds?: string[];
  @IsOptional()
  @IsArray()
  categoryIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsIn(STATUSES)
  status?: PromotionStatus;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  createdBy?: string;
}
