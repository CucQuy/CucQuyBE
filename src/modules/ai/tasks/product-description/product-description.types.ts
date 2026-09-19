/** Thông tin 1 sản phẩm đưa vào AI để viết mô tả (chỉ field cần thiết). */
export interface ProductForDescription {
  name: string;
  /** Nhãn loại tiếng Việt: Bánh / Nước / Combo. */
  typeLabel: string;
  /** Giá bán (VND) — AI chỉ dùng để chọn giọng văn, KHÔNG viết giá vào mô tả. */
  price?: number | null;
  /** Tên các vị đã khai báo. */
  flavors?: string[];
  /** Tên các size đã khai báo. */
  sizes?: string[];
  /** Mô tả đang có — AI viết lại cho mượt thay vì bịa mới. */
  current?: string | null;
}
