/**
 * Domain Khuyến mãi (promotions) — Phase 1.
 * Hỗ trợ: PERCENT / FIXED / FREE_SHIP (BUY_X_GET_Y để Phase 2).
 * Điều kiện: thời gian, ngưỡng đơn tối thiểu, phạm vi (toàn đơn/sản phẩm/danh mục), giới hạn lượt dùng.
 * Hình thức: CODE (nhập mã) hoặc AUTO (tự áp theo chiến dịch).
 */

export type ApplyMode = 'CODE' | 'AUTO';
export type DiscountType = 'PERCENT' | 'FIXED' | 'FREE_SHIP' | 'BUY_X_GET_Y';
export type PromotionScope = 'ALL' | 'PRODUCTS' | 'CATEGORIES';
export type PromotionStatus = 'active' | 'inactive';

export interface Promotion {
  id: string;
  name: string;
  applyMode: ApplyMode;
  code?: string | null; // chỉ khi applyMode = CODE (uppercase)
  discountType: DiscountType;
  discountValue?: number; // % (0–100) cho PERCENT, hoặc số tiền VND cho FIXED
  maxDiscount?: number | null; // trần giảm cho PERCENT

  // BUY_X_GET_Y theo NHÓM (badge): bỏ (buyQuantity+getQuantity) món cùng badge → getQuantity món RẺ NHẤT thành 0đ.
  groupBadgeId?: string | null; // badge gom nhóm sản phẩm điều kiện
  buyQuantity?: number; // N — số phải mua
  getQuantity?: number; // M — số được tặng (rẻ nhất)
  // (legacy, không dùng ở cơ chế nhóm)
  buyProductIds?: string[];
  getProductId?: string | null;

  // Điều kiện
  startAt?: string | null; // ISO
  endAt?: string | null; // ISO
  minOrderValue?: number; // ngưỡng subtotal
  scope: PromotionScope;
  productIds?: string[]; // scope = PRODUCTS
  categoryIds?: string[]; // scope = CATEGORIES

  // Giới hạn lượt dùng
  maxUses?: number | null; // tổng lượt; null = không giới hạn
  usedCount: number;

  status: PromotionStatus;
  priority?: number; // khi nhiều AUTO cùng thoả

  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

/** Một khuyến mãi đã áp vào đơn (lưu trong Order). */
export interface AppliedPromotion {
  promotionId: string;
  code?: string | null;
  name: string;
  type: DiscountType;
  amount: number; // số tiền đã giảm (VND)
}

/** Đầu vào tính giảm giá (dùng chung cho /preview và lúc tạo đơn). */
export interface ComputeCartLine {
  productId?: string;
  price: number;
  quantity: number;
}
export interface ComputeInput {
  items: ComputeCartLine[];
  decorations?: { price: number; quantity: number }[];
  shippingCost?: number;
  code?: string | null; // mã khách/CTV nhập
  promotionIds?: string[]; // chiến dịch CTV chọn áp (opt-in, không tự áp)
}

/** Quà tặng (Mua X tặng Y) — thêm vào đơn với giá 0. */
export interface GiftItem {
  productId: string;
  name: string;
  image?: string;
  quantity: number;
  price: 0;
}

/** Kết quả tính giảm giá — thẩm quyền từ backend. */
export interface ComputeResult {
  subtotal: number;
  shippingCost: number;
  discountAmount: number;
  total: number;
  appliedPromotions: AppliedPromotion[];
  giftItems: GiftItem[]; // quà tặng từ Mua X tặng Y (giá 0, không trừ tiền)
  errors: string[]; // vd "Mã không hợp lệ / đã hết hạn / hết lượt"
}
