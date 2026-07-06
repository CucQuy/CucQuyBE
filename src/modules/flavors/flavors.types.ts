/** Vị (flavor) — danh sách phẳng có màu, dùng cho sản phẩm & đơn hàng. */
export interface ProductFlavor {
  id: string;
  name: string;
  /** Hex color cho chip hiển thị */
  color?: string;
  /** Vị trí sort (số nhỏ hiện trước) */
  sortOrder?: number;
}
