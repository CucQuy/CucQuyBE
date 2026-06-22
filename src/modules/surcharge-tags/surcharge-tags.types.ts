/**
 * Tag phụ thu — loại phụ thu cho đơn (cộng vào subtotal trước giảm giá).
 * `key` là id ổn định: đơn cũ map theo key (orders.surcharge_tag).
 */
export interface SurchargeTag {
  /** Id ổn định (vd 'decoration' | 'theme' | 'accessory') */
  key: string;
  /** Nhãn hiển thị */
  label: string;
  /** Mức gợi ý (VND) */
  preset?: number;
  /** Bật/tắt tag */
  active?: boolean;
  /** Vị trí sort (số nhỏ hiện trước) */
  sortOrder?: number;
}
