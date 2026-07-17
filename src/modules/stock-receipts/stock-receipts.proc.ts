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

  async unreconcile(receiptId: string): Promise<{ ok: boolean }> {
    const [row] = await this.db.sql<{ result: { ok: boolean } }[]>`
      SELECT stock_receipt_unreconcile(${receiptId}) AS result`;
    return row.result;
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
