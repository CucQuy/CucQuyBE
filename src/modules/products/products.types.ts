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
  createdAt?: string; // ISO
}

/** 1 size của sản phẩm: tên + giá + ảnh (tùy chọn). */
export interface ProductSize {
  name: string;
  price: number;
  image?: string;
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
