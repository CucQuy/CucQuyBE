/** 1 sản phẩm AI đọc được từ ảnh đơn (chat/giấy ghi tay). */
export interface OrderExtractItem {
  /** Id sản phẩm khớp danh mục (null nếu AI không chắc → user tự chọn trong form). */
  productId: string | null;
  /** Tên đọc được trên ảnh (giữ nguyên chữ khách viết). */
  productName: string;
  quantity: number;
  /** Tên size khớp danh mục (null nếu SP không có size / không rõ). */
  size: string | null;
  /** Các vị khách chọn (nếu có). */
  flavors: string[];
  /** Giá khách chốt trên ảnh — null thì form tự lấy giá bảng. */
  unitPrice: number | null;
  /** Ghi chú riêng dòng này (vd "viết chữ Happy Birthday"). */
  note: string | null;
}

/** Kết quả quét ảnh → dữ liệu điền sẵn form tạo đơn (người vẫn phải check). */
export interface OrderExtracted {
  customerName: string | null;
  phone: string | null;
  address: string | null;
  /** yyyy-mm-dd */
  deliveryDate: string | null;
  /** HH:mm (24h) */
  deliveryTime: string | null;
  deliveryType: 'SHIP' | 'PICKUP' | 'SHIP_PROVINCE' | 'DINE_IN' | null;
  paymentMethod: 'CASH' | 'BANKING' | null;
  paymentStatus: 'PAID' | 'UNPAID' | 'DEPOSITED' | null;
  /** Tiền cọc khách đã chuyển (VND). */
  depositAmount: number | null;
  /** Phí ship khách chịu (VND). */
  shippingCost: number | null;
  note: string | null;
  items: OrderExtractItem[];
  /** Độ chắc tổng thể 0..1 — FE cảnh báo khi thấp. */
  confidence: number;
  /** Chỗ AI đoán / không đọc được — hiện cho user soát lại. */
  warningsVi: string[];
}

/** 1 ảnh FE gửi lên (base64 thuần, KHÔNG prefix data:image/...). */
export interface OrderExtractImage {
  base64: string;
  mimeType: string;
}

/** Danh mục sản phẩm rút gọn gửi kèm để AI map đúng productId. */
export interface OrderExtractCatalogItem {
  id: string;
  name: string;
  price: number;
  sizes?: string[];
  flavors?: string[];
}
