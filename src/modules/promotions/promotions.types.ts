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

/** 1 đợt chạy đã đóng của khuyến mãi (lưu trong runs khi mở lại). */
export interface PromotionRun {
  startAt?: string | null; // ISO — kỳ của đợt
  endAt?: string | null; // ISO
  usedCount: number; // lượt dùng trong đợt
  closedAt?: string | null; // ISO — thời điểm đóng đợt (bấm mở lại)
}

export interface Promotion {
  id: string;
  name: string;
  applyMode: ApplyMode;
  code?: string | null; // chỉ khi applyMode = CODE (uppercase)
  discountType: DiscountType;
  discountValue?: number; // % (0–100) cho PERCENT, hoặc số tiền VND cho FIXED
  maxDiscount?: number | null; // trần giảm cho PERCENT

  // BUY_X_GET_Y theo NHÓM: bỏ (buyQuantity+getQuantity) món cùng nhóm → getQuantity món RẺ NHẤT thành 0đ.
  groupCategoryId?: string | null; // TÊN danh mục gom nhóm (so khớp product.category). Ưu tiên dùng cái này.
  groupBadgeId?: string | null; // (legacy) badge gom nhóm — fallback khi chưa set groupCategoryId
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

  // Lịch sử các đợt chạy đã đóng (mỗi lần "mở lại" cất đợt hiện tại vào đây).
  runs?: PromotionRun[];
  runCount?: number; // = runs.length + 1 (đợt đang chạy), do BE tính

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
  /** Phụ thu tổng cho cả đơn (VND) — cộng vào subtotal TRƯỚC giảm giá. */
  surchargeAmount?: number;
  /** Nhãn loại phụ thu: 'decoration' | 'theme' | 'accessory'. */
  surchargeTag?: string;
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
