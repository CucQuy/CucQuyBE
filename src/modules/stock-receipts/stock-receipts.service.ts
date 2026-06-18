import { Injectable } from '@nestjs/common';
import {
  LineRow,
  MaterialRow,
  ReceiptRow,
  StockReceiptProc,
  SupplierRow,
} from './stock-receipts.proc';
import {
  BillLineItem,
  ImportedMaterialSummary,
  ImportedSupplierSummary,
  MaterialPriceOption,
  SavedStockReceiptDetail,
  SavedStockReceiptSummary,
  SaveStockReceiptDraftInput,
  StockReceiptValidationSnapshot,
  SupplierContactInfo,
} from './stock-receipts.types';

// ── Helpers map ─────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const numOr0 = (v: unknown): number => num(v) ?? 0;

const toIso = (v: string | Date | null): string | undefined => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

const mapSupplier = (r: SupplierRow): ImportedSupplierSummary => ({
  id: r.id,
  name: r.name ?? '(Unknown)',
  normalizedName: r.normalized_name ?? '',
  receiptCount: r.receipt_count ?? 0,
  totalAmount: numOr0(r.total_amount),
  lastReceiptDate: r.last_receipt_date ?? undefined,
  phone: r.phone,
  address: r.address,
});

const mapMaterial = (r: MaterialRow): ImportedMaterialSummary => ({
  id: r.id,
  name: r.name ?? '(Unknown)',
  normalizedName: r.normalized_name ?? '',
  importCount: r.import_count ?? 0,
  totalQty: numOr0(r.total_qty),
  totalAmount: numOr0(r.total_amount),
  lastSupplierName: r.last_supplier_name ?? undefined,
  lastReceiptDate: r.last_receipt_date ?? undefined,
});

const mapSummary = (r: ReceiptRow): SavedStockReceiptSummary => ({
  id: r.id,
  supplierNameRaw: r.supplier_name_raw,
  storeOrBranch: r.store_or_branch,
  receiptDate: r.receipt_date,
  invoiceNumber: r.invoice_number,
  totalAmount: num(r.total_amount),
  currency: r.currency || 'VND',
  productLineCount: r.product_line_count ?? 0,
  createdAt: toIso(r.created_at),
});

const mapLine = (l: LineRow): BillLineItem => ({
  name: l.name ?? '',
  quantity: num(l.quantity),
  unit: l.unit,
  unitPrice: num(l.unitPrice),
  lineTotal: num(l.lineTotal),
});

/** Toàn bộ logic ở stored function app.* — service chỉ gọi. */
@Injectable()
export class StockReceiptsService {
  constructor(private readonly proc: StockReceiptProc) {}

  // ── ĐỌC ────────────────────────────────────────────────────────────────────

  async fetchImportedSuppliers(): Promise<ImportedSupplierSummary[]> {
    const rows = await this.proc.supplierList();
    return rows.map(mapSupplier);
  }

  async fetchImportedMaterials(): Promise<ImportedMaterialSummary[]> {
    const rows = await this.proc.materialList();
    return rows.map(mapMaterial);
  }

  async fetchMaterialPriceOptions(): Promise<MaterialPriceOption[]> {
    const materials = await this.fetchImportedMaterials();
    return materials
      .map((m) => ({
        id: m.id,
        name: m.name,
        unitPrice: m.totalQty > 0 ? Math.round(m.totalAmount / m.totalQty) : 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  async fetchStockReceiptSummaries(): Promise<SavedStockReceiptSummary[]> {
    const rows = await this.proc.list();
    return rows.map(mapSummary);
  }

  async fetchStockReceiptDetail(
    receiptId: string,
  ): Promise<SavedStockReceiptDetail | null> {
    const rows = await this.proc.get(receiptId);
    const result = rows[0]?.result;
    if (!result) return null;

    const h = result.header;
    const lineItems = (result.lines ?? []).map(mapLine);

    const validation: StockReceiptValidationSnapshot = {
      isLikelyReceipt: Boolean(h.validation_is_likely_receipt),
      confidence: num(h.validation_confidence) ?? 0,
      reasonVi: h.validation_reason_vi ?? '',
      heuristicScore: num(h.validation_heuristic_score) ?? 0,
      heuristicNoteVi: h.validation_heuristic_note_vi ?? '',
    };

    return {
      id: h.id,
      supplierNameRaw: h.supplier_name_raw,
      storeOrBranch: h.store_or_branch,
      receiptDate: h.receipt_date,
      invoiceNumber: h.invoice_number,
      totalAmount: num(h.total_amount),
      currency: h.currency || 'VND',
      productLineCount: h.product_line_count ?? lineItems.length,
      createdAt: toIso(h.created_at),
      subtotal: num(h.subtotal),
      tax: num(h.tax),
      discount: num(h.discount),
      paymentMethod: h.payment_method,
      notes: h.notes,
      ocrText: h.ocr_text ?? '',
      receiptImageBase64: h.receipt_image_base64 ?? undefined,
      receiptImageMimeType: h.receipt_image_mime_type ?? undefined,
      lineItems,
      validation,
    };
  }

  // ── GHI ─────────────────────────────────────────────────────────────────────

  async updateSupplier(
    id: string,
    patch: Partial<SupplierContactInfo> & { name?: string },
  ): Promise<void> {
    await this.proc.supplierUpdate(id, patch);
  }

  /**
   * Lưu phiếu nhập: tạo receipt + lines + upsert supplier/materials + thống kê,
   * tất cả trong 1 transaction (1 lần gọi app.stock_receipt_create).
   * Trùng billHash -> proc RAISE 'DUPLICATE_BILL:<id>' -> ném lại như cũ.
   */
  async saveStockReceiptDraft(
    input: SaveStockReceiptDraftInput & { createdByUid?: string | null },
  ): Promise<{ id: string }> {
    try {
      const rows = await this.proc.create(input);
      return { id: rows[0].result.id };
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
      const m = msg.match(/DUPLICATE_BILL:(\S+)/);
      if (m) throw new Error(`DUPLICATE_BILL:${m[1]}`);
      throw err;
    }
  }

  async mergeSuppliers(rootId: string, duplicateIds: string[]): Promise<void> {
    await this.proc.mergeSuppliers(rootId, duplicateIds);
  }

  async mergeMaterials(rootId: string, duplicateIds: string[]): Promise<void> {
    await this.proc.mergeMaterials(rootId, duplicateIds);
  }
}
