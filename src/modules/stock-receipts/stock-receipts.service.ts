import { Injectable } from '@nestjs/common';
import {
  LineRow,
  MaterialRow,
  ReceiptRow,
  ReconcileReceiptItem,
  StockReceiptProc,
  SupplierRow,
} from './stock-receipts.proc';
import { AuthUser } from '../../auth/user.types';
import {
  BillLineItem,
  ImportedMaterialSummary,
  MaterialStock,
  ImportedSupplierSummary,
  MaterialPriceOption,
  MaterialUpdatePatch,
  MaterialCreateInput,
  SupplierCreateInput,
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
  contactPerson: r.contact_person,
  email: r.email,
  taxCode: r.tax_code,
  category: r.category,
  channel: r.channel ?? undefined,
  notes: r.notes,
  pinned: r.pinned === true,
});

const mapMaterial = (r: MaterialRow): ImportedMaterialSummary => ({
  id: r.id,
  name: r.name ?? '(Unknown)',
  normalizedName: r.normalized_name ?? '',
  importCount: r.import_count ?? 0,
  totalQty: numOr0(r.total_qty),
  totalAmount: numOr0(r.total_amount),
  canonicalUnit: r.canonical_unit ?? undefined,
  lastUnitPrice: r.last_unit_price != null ? numOr0(r.last_unit_price) : undefined,
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
  source: r.source ?? undefined,
  reconciled: Boolean(r.reconciled),
  transactionId: r.transaction_id ?? undefined,
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
  constructor(
    private readonly proc: StockReceiptProc,
  ) {}

  // ── ĐỌC ────────────────────────────────────────────────────────────────────

  async fetchImportedSuppliers(): Promise<ImportedSupplierSummary[]> {
    const rows = await this.proc.supplierList();
    return rows.map(mapSupplier);
  }

  async fetchImportedMaterials(): Promise<ImportedMaterialSummary[]> {
    const rows = await this.proc.materialList();
    return rows.map(mapMaterial);
  }

  /** Tồn dư (neo kiểm kê). Coerce số cho chắc. */
  async fetchMaterialStock(): Promise<MaterialStock[]> {
    const rows = await this.proc.materialStockEstimate();
    const arr = rows[0]?.result ?? [];
    const numOrNull = (v: unknown): number | null =>
      v === null || v === undefined ? null : Number(v);
    return arr.map((r) => ({
      materialId: String(r.materialId),
      unit: r.unit ?? null,
      hasStocktake: r.hasStocktake === true,
      stocktakeDate: r.stocktakeDate ?? null,
      stocktakeQty: numOrNull(r.stocktakeQty),
      importedAfter: numOrNull(r.importedAfter),
      consumedAfter: numOrNull(r.consumedAfter),
      remainingUnit: numOrNull(r.remainingUnit),
      remainingGrams: numOrNull(r.remainingGrams),
    }));
  }

  /** Ghi 1 lần kiểm kê NVL. */
  async recordStocktake(materialId: string, countedQty: number, countDate?: string, note?: string): Promise<void> {
    await this.proc.stocktakeUpsert({ materialId, countedQty, countDate: countDate || null, note: note || null });
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
      shippingFee: num(h.shipping_fee),
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
    patch: Partial<SupplierContactInfo> & { name?: string; pinned?: boolean },
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

  /** Sửa nguyên liệu (NVL): name / canonicalUnit. */
  async updateMaterial(id: string, patch: MaterialUpdatePatch): Promise<void> {
    await this.proc.materialUpdate(id, patch);
  }

  /** Tạo NVL thủ công (không qua phiếu nhập). Trả id (idempotent theo key). */
  async createMaterial(input: MaterialCreateInput): Promise<string> {
    return this.proc.materialCreate(input);
  }

  async createSupplier(input: SupplierCreateInput): Promise<string> {
    return this.proc.supplierCreate(input);
  }

  // ── Đối soát phiếu nhập ↔ giao dịch tiền ra (009) ──────────────────────────
  async listReceiptsForReconcile(): Promise<ReconcileReceiptItem[]> {
    return this.proc.listForReconcile();
  }

  async reconcileReceipt(
    receiptId: string,
    transactionId: string,
    currentUser: AuthUser,
  ): Promise<{ ok: boolean }> {
    return this.proc.reconcile(receiptId, transactionId, {
      uid: currentUser?.uid ?? '',
      displayName: currentUser?.displayName ?? '',
      email: currentUser?.email ?? '',
    });
  }

  async unreconcileReceipt(receiptId: string): Promise<{ ok: boolean }> {
    return this.proc.unreconcile(receiptId);
  }

  /** Tổng hợp phân bổ (paid/remaining/reconciled + danh sách GD) của 1 bill. */
  async allocSummary(receiptId: string) {
    return this.proc.allocSummary(receiptId);
  }

  /** GD tiền ra còn lại có thể gắn cho 1 bill. */
  async allocAvailable(receiptId: string) {
    return this.proc.allocAvailable(receiptId);
  }

  /** Thêm/sửa 1 phân bổ GD ↔ bill. */
  async allocAdd(receiptId: string, transactionId: string, amount?: number | null) {
    return this.proc.allocAdd(receiptId, transactionId, amount);
  }

  /** Xoá 1 phân bổ theo id. */
  async allocRemove(allocId: string) {
    return this.proc.allocRemove(allocId);
  }

  /** Đánh dấu / bỏ đánh dấu "đã khớp dù lệch" cho 1 bill. */
  async allocSetForced(receiptId: string, forced: boolean) {
    return this.proc.allocSetForced(receiptId, forced);
  }

  /** Gợi ý cặp khớp tự động tiền ra ↔ phiếu nhập (dry-run). windowDays=0 → chỉ theo số tiền. */
  async reconcilePreview(windowDays = 0) {
    return this.proc.reconcilePreview(Math.min(Math.max(windowDays, 0), 3650));
  }

  /** Áp danh sách cặp {receiptId, transactionId} đã confirm. */
  async reconcileApply(pairs: unknown) {
    return this.proc.reconcileApply(pairs);
  }

  /** GD tiền ra chưa gắn phiếu (cho màn khớp tay). */
  async listUnlinkedOutTxns() {
    return this.proc.unlinkedOutTxns();
  }

  /** Kiểm tra bill đang up đã có trong hệ thống chưa (trước khi lưu). */
  async findDuplicate(input: unknown) {
    const rows = await this.proc.findDuplicate(input);
    return rows[0]?.result ?? { duplicate: false };
  }

  /** Xoá phiếu nhập (cascade + recompute). Dùng cho SỬA: FE tạo bản mới rồi xoá bản cũ. */
  async deleteReceipt(
    receiptId: string,
  ): Promise<{ ok: boolean; reason?: string; id?: string }> {
    return this.proc.delete(receiptId);
  }
}
