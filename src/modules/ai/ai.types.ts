/** Kết quả kiểm tra "có phải bill/phiếu mua hàng" sau OCR (port từ FE). */
export interface BillValidationResult {
  isLikelyReceipt: boolean;
  /** 0–1 */
  confidence: number;
  /** Giải thích ngắn (tiếng Việt) */
  reasonVi: string;
}

export interface BillLineItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  /** Phân loại dòng (AI gợi ý / người chọn): NVL | Tài sản | Chi phí vận hành. */
  itemType?: 'material' | 'asset' | 'opex';
  /** Độ chắc phân loại của AI (0..1). */
  confidence?: number;
  /** Số tháng khấu hao gợi ý (khi asset). */
  suggestedUsefulMonths?: number | null;
  /** Loại gợi ý (asset: equipment/...; opex: rent/utilities/...). */
  category?: string | null;
}

/** Kết quả chuẩn hoá từ hoá đơn / phiếu nhập hàng (OCR + LLM). */
export interface StockReceiptStructured {
  /** Tên NCC / cửa hàng / siêu thị trên bill */
  supplierName: string | null;
  /** Số điện thoại NCC trích từ bill (ĐT/SĐT/Hotline). */
  supplierPhone: string | null;
  /** Địa chỉ NCC trích từ bill (Địa chỉ / Đ/C / Address). */
  supplierAddress: string | null;
  /** Mã / Số hoá đơn trên bill (HĐGTGT, Số HĐ, Mã HĐ, "Hoá đơn số:"). */
  invoiceNumber: string | null;
  /** Địa chỉ hoặc chi nhánh nếu có */
  storeOrBranch: string | null;
  /** Ngày trên bill, ưu tiên ISO yyyy-mm-dd */
  receiptDate: string | null;
  /** Giờ nếu có */
  receiptTime: string | null;
  lineItems: BillLineItem[];
  /** Số dòng sản phẩm (có thể khác length nếu gộp dòng) */
  productLineCount: number;
  subtotal: number | null;
  tax: number | null;
  /** Phí vận chuyển gốc (dương). Bill sàn TMĐT hay có. */
  shippingFee: number | null;
  /** Tổng giảm (gồm ưu đãi phí vận chuyển), số dương. */
  discount: number | null;
  /** Tổng thanh toán = subtotal + tax + shippingFee − discount */
  totalAmount: number | null;
  currency: string;
  paymentMethod: string | null;
  notes: string | null;
}
