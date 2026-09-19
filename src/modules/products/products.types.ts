/**
 * Types domain Product — khớp cột bảng Postgres (public.products).
 * Giữ field name camelCase mà API/FE đang dùng.
 */

export interface Product {
  id: string;
  name: string;
  price?: number;
  costPrice?: number;
  description?: string;
  status?: 'active' | 'inactive' | string;
  /** Tên danh mục (text) */
  category?: string;
  /** FK -> categories.id (resolve từ tên category) */
  categoryId?: string;
  tags?: string[];
  image?: string;
  /** Ảnh phụ (gallery) */
  gallery?: string[];
  recipeId?: string;
  cakesPerProduct?: number;
  /** Vị (multi-select) — không ảnh hưởng giá */
  flavors?: string[];
  /** Size (biến thể giá) — giá dòng đơn lấy theo size chọn */
  sizes?: ProductSize[];
  /** Biến thể vị: mỗi vị có ảnh + giá riêng (giá dòng = tổng vị chọn) */
  flavorVariants?: ProductFlavorVariant[];
  /** Phân loại sản phẩm (cake mặc định / packaging / decoration / accessory / service). */
  type?: string;
  /** Giá bậc theo SL: [{minQty, price}] — giá/đơn vị khi tổng SL >= minQty. */
  priceTiers?: PriceTier[];
  /** SP phụ phí tự thêm (qty đồng bộ) khi SP này vào đơn. (legacy — dùng packagingOptions) */
  addOnProductIds?: string[];
  /** Option gói: mỗi option 1 phí/đơn vị cộng vào giá bậc. Chọn 1 option/dòng đơn. */
  packagingOptions?: PackagingOption[];
  createdAt?: string; // ISO
}

/** 1 bậc giá theo số lượng. price = đơn giá khi tổng SL >= minQty. */
export interface PriceTier {
  minQty: number;
  price: number;
}

/** 1 option gói: nhãn + phí cộng thêm mỗi đơn vị (VND). */
export interface PackagingOption {
  label: string;
  perUnit: number;
}

/** 1 size của sản phẩm: tên + giá + ảnh + số cái combo (tùy chọn). */
export interface ProductSize {
  name: string;
  price: number;
  image?: string;
  count?: number;
}

/** 1 biến thể vị: tên + ảnh riêng + giá riêng (tùy chọn). */
export interface ProductFlavorVariant {
  name: string;
  image?: string;
  price?: number;
}

/**
 * Lịch sử version của sản phẩm. Bảng mới:
 *   product_versions(id, product_id, action, edited_at)
 *   product_version_changes(version_id, field, before_value, after_value)
 * Service gộp lại shape cũ (before/changes/after) để FE không phải sửa.
 */
export interface ProductVersion {
  id: string;
  productId: string;
  action: 'update' | string;
  editedAt?: string; // ISO
  /** { field: before_value } */
  before?: Record<string, unknown>;
  /** { field: after_value } */
  changes?: Record<string, unknown>;
  /** { field: after_value } */
  after?: Record<string, unknown>;
}

/** 1 món trong combo — trỏ sản phẩm có sẵn (bảng product_combo_items). */
export interface ComboItem {
  id?: number;
  productId: string;
  name?: string;
  /** Số phần trong box (2 viên phô mai dẻo → 2). */
  qty: number;
  /** 1 phần = bao nhiêu đơn vị bán lẻ của SP đó (hộp 10 cái → 0.1). */
  portion: number;
  unitLabel?: string | null;
  note?: string | null;
  sortOrder?: number;
  /** Giá lẻ / giá vốn quy đổi (DB tính, chỉ đọc). */
  unitRetail?: number;
  lineRetail?: number;
  unitCost?: number;
  lineCost?: number;
}

/** Combo + đối chiếu giá lẻ (product_combo_get). */
export interface ProductCombo {
  comboId: string;
  name: string;
  price?: number;
  costPrice?: number;
  status?: string;
  /** Tổng số phần trong box. */
  itemCount: number;
  /** Tổng giá lẻ các món cộng lại. */
  retailSum: number;
  saving: number;
  savingPct: number;
  items: ComboItem[];
}
