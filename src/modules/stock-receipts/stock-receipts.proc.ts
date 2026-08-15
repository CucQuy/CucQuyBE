import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  MaterialMergeSuggestion,
  MaterialUpdatePatch,
  MaterialCreateInput,
  SaveStockReceiptDraftInput,
  SupplierContactInfo,
} from './stock-receipts.types';

// ── Rows trả về từ * (snake_case khớp cột bảng) ─────────────────────────

/** 1 phiếu nhập + field đối soát (camelCase từ jsonb fn). */
export type ReconcileReceiptItem = {
  receiptId: string;
  supplierName: string | null;
  totalAmount: number | null;
  receiptDate: string | null;
  invoiceNumber: string | null;
  transactionId: string | null;
  reconciled: boolean;
};

/** 1 cặp gợi ý đối soát (tiền ra ↔ phiếu nhập). */
export type ReceiptReconcileMatch = {
  transactionId: string;
  receiptId: string;
  amount: number;
  transactionDate: string | null;
  receiptDate: string | null;
  dateGap: number | null; // số ngày lệch (null nếu thiếu ngày)
  txCand: number; // số phiếu cùng số tiền mà GD này khớp
  receiptCand: number; // số GD cùng số tiền mà phiếu này khớp
  gateway: string | null;
  supplier: string | null;
  invoiceNumber: string | null;
  description: string | null;
};

export type ReceiptReconcilePreview = {
  matched: ReceiptReconcileMatch[];
  uniqueCount: number; // số cặp 1-1 (txCand=1 & receiptCand=1) — an toàn tự chọn
  ambiguousCount: number; // số cặp có nhiều ứng viên
  totalUnlinkedTx: number;
  totalUnlinkedReceipt: number;
};

/** 1 giao dịch tiền ra chưa gắn phiếu (cho màn khớp tay). */
export type UnlinkedOutTxn = {
  id: string;
  amount: number;
  transactionDate: string | null;
  gateway: string | null;
  content: string | null;
};

export type SupplierRow = {
  id: string;
  name: string | null;
  normalized_name: string | null;
  receipt_count: number | null;
  total_amount: string | number | null;
  last_receipt_date: string | null;
  phone: string | null;
  address: string | null;
  contact_person: string | null;
  email: string | null;
  tax_code: string | null;
  category: string | null;
  channel: string | null;
  notes: string | null;
};

export type MaterialRow = {
  id: string;
  name: string | null;
  normalized_name: string | null;
  canonical_unit: string | null;
  import_count: number | null;
  total_qty: string | number | null;
  total_amount: string | number | null;
  last_unit_price: string | number | null;
  last_supplier_id: string | null;
  last_supplier_name: string | null;
  last_receipt_date: string | null;
};

/** 1 dòng tồn dư ước tính (neo kiểm kê) — camelCase từ material_stock_estimate. */
export type MaterialStockRow = {
  materialId: string;
  unit: string | null;
  gramsPerUnit: number | null;
  hasStocktake: boolean;
  stocktakeDate: string | null;
  stocktakeQty: number | null;
  importedAfter: number | null;
  consumedAfter: number | null;
  remainingUnit: number | null;
  remainingGrams: number | null;
};


export type ReceiptRow = {
  id: string;
  supplier_id: string | null;
  supplier_name_raw: string | null;
  supplier_name_canonical: string | null;
  store_or_branch: string | null;
  invoice_number: string | null;
  supplier_phone: string | null;
  supplier_address: string | null;
  receipt_date: string | null;
  receipt_time: string | null;
  subtotal: string | number | null;
  tax: string | number | null;
  shipping_fee: string | number | null;
  discount: string | number | null;
  total_amount: string | number | null;
  currency: string | null;
  payment_method: string | null;
  notes: string | null;
  product_line_count: number | null;
  ocr_text: string | null;
  receipt_image_base64: string | null;
  receipt_image_mime_type: string | null;
  validation_is_likely_receipt: boolean | null;
  validation_confidence: string | number | null;
  validation_reason_vi: string | null;
  validation_heuristic_score: string | number | null;
  validation_heuristic_note_vi: string | null;
  amount_check_sum_lines: string | number | null;
  amount_check_delta_pct: string | number | null;
  amount_check_warn: boolean | null;
  bill_hash: string | null;
  status: string | null;
  source: string | null;
  reconciled: boolean | null;
  transaction_id: string | null;
  created_by_uid: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

export type LineRow = {
  name: string | null;
  quantity: string | number | null;
  unit: string | null;
  unitPrice: string | number | null;
  lineTotal: string | number | null;
};

/**
 * Tầng quản lý stored procedure của domain stock receipts.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class StockReceiptProc {
  constructor(private readonly db: DbService) {}

  // ── ĐỌC ────────────────────────────────────────────────────────────────────

  supplierList(): Promise<SupplierRow[]> {
    return this.db
      .sql<SupplierRow[]>`SELECT * FROM stock_receipt_supplier_list()`;
  }

  materialList(): Promise<MaterialRow[]> {
    return this.db
      .sql<MaterialRow[]>`SELECT * FROM stock_receipt_material_list()`;
  }

  /** Tồn dư ước tính (neo kiểm kê). */
  materialStockEstimate(): Promise<{ result: MaterialStockRow[] }[]> {
    return this.db
      .sql<{ result: MaterialStockRow[] }[]>`SELECT material_stock_estimate() AS result`;
  }

  /** Ghi 1 lần kiểm kê NVL (đếm tay). */
  stocktakeUpsert(body: unknown): Promise<unknown> {
    return this.db.sql`SELECT * FROM material_stocktake_upsert(${this.db.json(body ?? {})}::jsonb)`;
  }

  list(): Promise<ReceiptRow[]> {
    return this.db.sql<ReceiptRow[]>`SELECT * FROM stock_receipt_list()`;
  }

  // ── Đối soát phiếu nhập ↔ giao dịch tiền ra (009) ──────────────────────────
  async listForReconcile(): Promise<ReconcileReceiptItem[]> {
    const [row] = await this.db.sql<{ list: ReconcileReceiptItem[] }[]>`
      SELECT stock_receipt_list_for_reconcile() AS list`;
    return row?.list ?? [];
  }

  async reconcile(
    receiptId: string,
    transactionId: string,
    userJson: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    const [row] = await this.db.sql<{ result: { ok: boolean } }[]>`
      SELECT stock_receipt_reconcile(
        ${receiptId}, ${transactionId}, ${this.db.json(userJson)}::jsonb
      ) AS result`;
    return row.result;
  }

  async delete(receiptId: string): Promise<{ ok: boolean; reason?: string; id?: string }> {
    const rows = await this.db.sql<{ result: { ok: boolean; reason?: string; id?: string } }[]>`
      SELECT stock_receipt_delete(${receiptId}) AS result`;
    return rows[0].result;
  }

  async unreconcile(receiptId: string): Promise<{ ok: boolean }> {
    const [row] = await this.db.sql<{ result: { ok: boolean } }[]>`
      SELECT stock_receipt_unreconcile(${receiptId}) AS result`;
    return row.result;
  }

  /** Tổng hợp phân bổ tiền của 1 bill (nhiều GD/bill). */
  async allocSummary(receiptId: string): Promise<unknown> {
    const [row] = await this.db.sql<{ result: unknown }[]>`
      SELECT receipt_alloc_summary(${receiptId}) AS result`;
    return row?.result ?? null;
  }

  /** GD tiền ra còn lại để gắn cho 1 bill. */
  async allocAvailable(receiptId: string): Promise<unknown> {
    const [row] = await this.db.sql<{ result: unknown }[]>`
      SELECT receipt_available_out_txns(${receiptId}) AS result`;
    return row?.result ?? [];
  }

  /** Thêm/sửa 1 phân bổ (amount rỗng → tự tính). */
  async allocAdd(
    receiptId: string,
    transactionId: string,
    amount?: number | null,
  ): Promise<unknown> {
    const input = { receiptId, transactionId, amount: amount ?? null };
    const [row] = await this.db.sql<{ result: unknown }[]>`
      SELECT receipt_alloc_add(${this.db.json(input)}::jsonb) AS result`;
    return row.result;
  }

  /** Xoá 1 phân bổ theo id. */
  async allocRemove(allocId: string): Promise<unknown> {
    const [row] = await this.db.sql<{ result: unknown }[]>`
      SELECT receipt_alloc_remove(${allocId}) AS result`;
    return row.result;
  }

  /** Đánh dấu / bỏ đánh dấu "đã khớp dù lệch" cho 1 bill. */
  async allocSetForced(receiptId: string, forced: boolean): Promise<unknown> {
    const [row] = await this.db.sql<{ result: unknown }[]>`
      SELECT receipt_alloc_set_forced(${receiptId}, ${forced}) AS result`;
    return row.result;
  }

  /** Gợi ý cặp khớp tự động (dry-run). */
  async reconcilePreview(windowDays: number): Promise<ReceiptReconcilePreview> {
    const [row] = await this.db.sql<{ result: ReceiptReconcilePreview }[]>`
      SELECT stock_receipt_reconcile_preview(${windowDays}) AS result`;
    return row.result;
  }

  /** Áp danh sách cặp đã confirm. */
  async reconcileApply(
    pairs: unknown,
  ): Promise<{ applied: number; skipped: number }> {
    const [row] = await this.db.sql<{ result: { applied: number; skipped: number } }[]>`
      SELECT stock_receipt_reconcile_apply(${this.db.json(pairs ?? [])}::jsonb) AS result`;
    return row.result;
  }

  /** Kiểm tra bill đang up đã có trong hệ thống chưa (theo bill_hash). */
  async findDuplicate(input: unknown): Promise<
    { result: { duplicate: boolean; receipt?: unknown } }[]
  > {
    return this.db.sql<{ result: { duplicate: boolean; receipt?: unknown } }[]>`
      SELECT stock_receipt_find_duplicate(${this.db.json(input ?? {})}::jsonb) AS result`;
  }

  /** GD tiền ra chưa gắn phiếu (khớp tay). */
  async unlinkedOutTxns(): Promise<UnlinkedOutTxn[]> {
    const [row] = await this.db.sql<{ list: UnlinkedOutTxn[] }[]>`
      SELECT stock_receipt_unlinked_out_txns() AS list`;
    return row?.list ?? [];
  }

  get(
    receiptId: string,
  ): Promise<{ result: { header: ReceiptRow; lines: LineRow[] } | null }[]> {
    return this.db.sql<
      { result: { header: ReceiptRow; lines: LineRow[] } | null }[]
    >`SELECT stock_receipt_get(${receiptId}) AS result`;
  }

  // ── GHI ─────────────────────────────────────────────────────────────────────

  supplierUpdate(
    id: string,
    patch: Partial<SupplierContactInfo> & { name?: string },
  ): Promise<unknown> {
    return this.db.sql`
      SELECT stock_receipt_supplier_update(${id}, ${this.db.json(patch ?? {})}::jsonb)`;
  }

  create(
    input: SaveStockReceiptDraftInput & { createdByUid?: string | null },
  ): Promise<{ result: { id: string } }[]> {
    return this.db.sql<{ result: { id: string } }[]>`
      SELECT stock_receipt_create(${this.db.json(input)}::jsonb) AS result`;
  }

  mergeSuppliers(rootId: string, duplicateIds: string[]): Promise<unknown> {
    return this.db.sql`
      SELECT stock_receipt_merge_suppliers(
        ${rootId}, ${this.db.json(duplicateIds ?? [])}::jsonb)`;
  }

  mergeMaterials(rootId: string, duplicateIds: string[]): Promise<unknown> {
    return this.db.sql`
      SELECT stock_receipt_merge_materials(
        ${rootId}, ${this.db.json(duplicateIds ?? [])}::jsonb)`;
  }

  /** Gợi ý các cặp nguyên liệu nghi trùng (jsonb array passthrough). */
  async materialMergeSuggestions(
    threshold: number,
  ): Promise<MaterialMergeSuggestion[]> {
    const [row] = await this.db.sql<{ result: MaterialMergeSuggestion[] }[]>`
      SELECT stock_receipt_material_merge_suggestions(${threshold}::real) AS result`;
    return row?.result ?? [];
  }

  /** Sửa nguyên liệu (NVL) — partial update qua jsonb patch. */
  materialUpdate(id: string, patch: MaterialUpdatePatch): Promise<unknown> {
    return this.db.sql`
      SELECT stock_receipt_material_update(${id}, ${this.db.json(patch ?? {})}::jsonb)`;
  }

  /** Tạo NVL thủ công — trả id (idempotent theo key). */
  async materialCreate(input: MaterialCreateInput): Promise<string> {
    const [row] = await this.db.sql<{ id: string }[]>`
      SELECT stock_receipt_material_create(${this.db.json(input)}::jsonb) AS id`;
    return row.id;
  }
}
