/** Types cho domain nhập kho (stock receipts) — khớp với FE types/billReceipt.ts. */

export interface BillLineItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
}

export interface StockReceiptStructured {
  supplierName: string | null;
  supplierPhone: string | null;
  supplierAddress: string | null;
  invoiceNumber: string | null;
  storeOrBranch: string | null;
  receiptDate: string | null;
  receiptTime: string | null;
  lineItems: BillLineItem[];
  productLineCount: number;
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  totalAmount: number | null;
  currency: string;
  paymentMethod: string | null;
  notes: string | null;
}

export interface StockReceiptValidationSnapshot {
  isLikelyReceipt: boolean;
  confidence: number;
  reasonVi: string;
  heuristicScore: number;
  heuristicNoteVi: string;
}

/**
 * Thông tin liên hệ NCC. Bảng `suppliers` chỉ có cột phone/address nên các field
 * còn lại (contactPerson/email/taxCode/category/notes) hiện KHÔNG được lưu —
 * proc app.* sẽ bỏ qua. Giữ optional để API/FE cũ không vỡ.
 */
export interface SupplierContactInfo {
  phone?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  taxCode?: string | null;
  category?: string | null;
  notes?: string | null;
}

export interface SavedStockReceiptSummary {
  id: string;
  supplierNameRaw: string | null;
  storeOrBranch: string | null;
  receiptDate: string | null;
  invoiceNumber: string | null;
  totalAmount: number | null;
  currency: string;
  productLineCount: number;
  createdAt?: string;
}

export interface SavedStockReceiptDetail extends SavedStockReceiptSummary {
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  paymentMethod: string | null;
  notes: string | null;
  ocrText: string;
  receiptImageBase64?: string;
  receiptImageMimeType?: string;
  lineItems: BillLineItem[];
  validation: StockReceiptValidationSnapshot;
}

export interface ImportedSupplierSummary extends SupplierContactInfo {
  id: string;
  name: string;
  normalizedName: string;
  receiptCount: number;
  totalAmount: number;
  lastReceiptDate?: string;
}

export interface ImportedMaterialSummary {
  id: string;
  name: string;
  normalizedName: string;
  importCount: number;
  totalQty: number;
  totalAmount: number;
  lastSupplierName?: string;
  lastReceiptDate?: string;
}

export interface MaterialPriceOption {
  id: string;
  name: string;
  unitPrice: number;
}

/** Nguồn tạo phiếu nhập: OCR ảnh bill hoặc nhập thủ công qua form. */
export type StockReceiptSource = 'ocr' | 'manual';

/** Payload lưu phiếu nhập (saveStockReceiptDraft). */
export interface SaveStockReceiptDraftInput {
  structured: StockReceiptStructured;
  validation: StockReceiptValidationSnapshot;
  ocrText: string;
  receiptImageBase64?: string | null;
  receiptImageMimeType?: string | null;
  targetSupplierId?: string | null;
  supplierContact?: SupplierContactInfo | null;
  /** Mặc định 'ocr' (BE coi thiếu = 'ocr'). 'manual' → bỏ chống trùng DUPLICATE_BILL. */
  source?: StockReceiptSource;
}
