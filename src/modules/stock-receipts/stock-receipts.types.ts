/** Types cho domain nhập kho (stock receipts) — khớp với FE types/billReceipt.ts. */

export interface BillLineItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  /** Phân loại dòng: 'material' (NVL) | 'asset' (tài sản) | 'opex' (chi phí vận hành). */
  itemType?: 'material' | 'asset' | 'opex';
  /** Số tháng khấu hao (khi asset). */
  usefulMonths?: number | null;
  /** Loại (asset/opex). */
  category?: string | null;
  /** Vết AI gợi ý. */
  aiSuggestedType?: string | null;
  aiConfidence?: number | null;
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
 * Thông tin liên hệ NCC — lưu đầy đủ vào bảng `suppliers`
 * (phone/address/contact_person/email/tax_code/category/notes; migration 011).
 * `category` lưu dạng text tự do (FE dùng union ingredient|packaging|equipment|
 * other) — BE không enforce. Giữ optional để API/FE cũ không vỡ.
 */
export interface SupplierContactInfo {
  phone?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  taxCode?: string | null;
  category?: string | null;
  channel?: string | null;
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
  source?: string;
  reconciled?: boolean;
  transactionId?: string;
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
  canonicalUnit?: string;
  lastUnitPrice?: number;
  lastSupplierName?: string;
  lastReceiptDate?: string;
}

export interface MaterialPriceOption {
  id: string;
  name: string;
  unitPrice: number;
}

/** Patch sửa nguyên liệu (NVL) — partial update qua jsonb. */
export interface MaterialUpdatePatch {
  name?: string;
  canonicalUnit?: string | null;
}

/** Tạo NVL thủ công (không qua phiếu nhập). */
export interface MaterialCreateInput {
  name: string;
  unit?: string | null;
  lastUnitPrice?: number | null;
}

/** 1 nguyên liệu trong cặp gợi ý gộp (camelCase từ jsonb fn). */
export interface MaterialMergeCandidate {
  id: string;
  name: string;
  importCount: number;
  totalQty: number;
  canonicalUnit: string | null;
}

/** 1 cặp nguyên liệu nghi trùng + độ tương đồng (0..1). */
export interface MaterialMergeSuggestion {
  similarity: number;
  a: MaterialMergeCandidate;
  b: MaterialMergeCandidate;
}

/** 1 nhóm NVL do Claude gợi ý gộp (cùng sản phẩm) — đã map id → dữ liệu thật. */
export interface MaterialMergeAiGroup {
  members: MaterialMergeCandidate[];
  /** Tên chuẩn Claude đề xuất. */
  suggestedName: string;
  /** Đơn vị chuẩn Claude đề xuất (null nếu không chắc). */
  suggestedUnit: string | null;
  /** Độ tin cậy 0–1. */
  confidence: number;
  /** Lý do ngắn (tiếng Việt). */
  reason: string;
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
