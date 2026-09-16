import { Injectable, Logger } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { ReceiptStructureService } from '../ai/tasks/receipt-structure/receipt-structure.service';
import { StockReceiptStructured } from '../ai/ai.types';
import { readBills } from './lib/zalo-db';
import { jxlToJpeg } from './lib/jxl';

export interface ZaloBillImageOut {
  msgId: string;
  ts: number;
  dName: string;
  /** JPEG base64 thuần (không prefix data:) — FE đổi sang File cho modal nhập hàng loạt. */
  base64: string;
}

/** Bill TEXT (nhập tay) đã được AI phân tích thành cấu trúc phiếu nhập. */
export interface ZaloTextBillOut {
  msgId: string;
  ts: number;
  dName: string;
  text: string;
  structured: StockReceiptStructured;
}

export interface ZaloBillsSyncResult {
  ok: boolean;
  groupId: string;
  images: ZaloBillImageOut[];
  textBills: ZaloTextBillOut[];
  /** Tổng bill ảnh khớp mốc (trước khi cắt) — để FE báo "còn N ảnh nữa". */
  total: number;
  error?: string;
}

/** Trần mỗi lần bấm: ảnh (payload/OCR) và text (số lần gọi AI). */
const MAX_IMAGES = 30;
const MAX_TEXT = 20;

@Injectable()
export class ZaloBillsService {
  private readonly logger = new Logger(ZaloBillsService.name);

  constructor(
    private readonly events: EventsGateway,
    private readonly receiptStructure: ReceiptStructureService,
  ) {}

  agents() {
    return this.events.listZaloAgents();
  }

  /**
   * Lấy bill từ nhóm Zalo theo mốc `sinceTs` (ms; 0 = tất cả). Agent trả DB + key →
   * BE giải mã (node:crypto + sql.js, áp WAL). Ảnh: tải + convert JXL→JPG (WASM).
   * Text (nhập tay): AI phân tích → cấu trúc phiếu nhập. Không lib native.
   */
  async sync(machineId: string | undefined, sinceTs: number): Promise<ZaloBillsSyncResult> {
    const fail = (error: string, groupId = ''): ZaloBillsSyncResult => ({
      ok: false,
      groupId,
      images: [],
      textBills: [],
      total: 0,
      error,
    });

    const db = await this.events.requestZaloDb(machineId);
    if (!db.ok || !db.dbBase64 || !db.cipherKey) {
      return fail(db.error || 'Máy đọc Zalo không trả được dữ liệu');
    }

    let bills;
    try {
      const buf = Buffer.from(db.dbBase64, 'base64');
      const wal = db.walBase64 ? Buffer.from(db.walBase64, 'base64') : undefined;
      bills = await readBills(buf, db.cipherKey, sinceTs, wal);
    } catch (e) {
      this.logger.error(`Giải mã DB lỗi: ${e instanceof Error ? e.message : e}`);
      return fail('Giải mã DB nhóm thất bại', db.groupId);
    }

    // Ảnh bill → tải + convert JXL→JPG.
    const pickImg = bills.photos.slice(0, MAX_IMAGES);
    const images: ZaloBillImageOut[] = [];
    for (const p of pickImg) {
      try {
        const res = await fetch(p.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const jxl = Buffer.from(await res.arrayBuffer());
        const jpg = await jxlToJpeg(jxl);
        images.push({ msgId: p.msgId, ts: p.ts, dName: p.dName, base64: jpg.toString('base64') });
      } catch (e) {
        this.logger.warn(`Tải/convert ảnh ${p.msgId} lỗi: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Bill text → AI phân tích thành cấu trúc phiếu nhập.
    const pickText = bills.textBills.slice(0, MAX_TEXT);
    const textBills: ZaloTextBillOut[] = [];
    for (const b of pickText) {
      try {
        const structured = await this.receiptStructure.run(b.text);
        // Bỏ kết quả rỗng (AI không tìm ra gì → không phải bill).
        const hasItem = (structured.lineItems ?? []).some((l) => (l.name ?? '').trim() !== '');
        const hasMoney = typeof structured.totalAmount === 'number' && structured.totalAmount > 0;
        if (!hasItem && !hasMoney) continue;
        textBills.push({ msgId: b.msgId, ts: b.ts, dName: b.dName, text: b.text, structured });
      } catch (e) {
        this.logger.warn(`AI parse text bill ${b.msgId} lỗi: ${e instanceof Error ? e.message : e}`);
      }
    }

    this.logger.log(
      `zalo-bills sync: ${bills.photos.length} ảnh / ${bills.textBills.length} text khớp mốc → ` +
        `trả ${images.length} ảnh + ${textBills.length} text (group ${db.groupId})`,
    );
    return { ok: true, groupId: db.groupId, images, textBills, total: bills.photos.length };
  }
}
