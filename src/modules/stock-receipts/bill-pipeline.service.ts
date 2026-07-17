import { BadRequestException, Injectable } from '@nestjs/common';
import { OcrService } from '../ocr/ocr.service';
import { ReceiptValidateService } from '../ai/tasks/receipt-validate/receipt-validate.service';
import { ReceiptStructureService } from '../ai/tasks/receipt-structure/receipt-structure.service';
import {
  StockReceiptStructured,
  StockReceiptValidationSnapshot,
} from './stock-receipts.types';

/**
 * Kết quả pipeline xử lý bill (OCR + AI + gating) — khớp shape FE kỳ vọng.
 */
export interface BillPipelineResult {
  ocrText: string;
  structured: StockReceiptStructured;
  validation: StockReceiptValidationSnapshot;
}

/** Ngưỡng tối thiểu: AI đánh giá đây là bill và độ tin cậy đủ cao. */
const MIN_LLM_CONFIDENCE = 0.42;

const RECEIPT_KEYWORDS_VI = [
  'hóa đơn',
  'hoá đơn',
  'hđgtgt',
  'hđ',
  'vat',
  'mst',
  'mã số thuế',
  'tổng cộng',
  'tổng tiền',
  'thành tiền',
  'cộng tiền',
  'phiếu',
  'biên lai',
  'siêu thị',
  'công ty',
  'tnhh',
  'địa chỉ',
  'sđt',
  'điện thoại',
  'nhập hàng',
  'mua hàng',
  'giảm giá',
  'chiết khấu',
  'thanh toán',
  'tiền mặt',
  'chuyển khoản',
  'pos',
  'cashier',
];

const RECEIPT_KEYWORDS_EN = [
  'invoice',
  'receipt',
  'total',
  'tax',
  'subtotal',
  'amount',
  'bill to',
  'thank you',
  'payment',
];

/**
 * Các cụm từ "chắc chắn là bill" trong OCR — đã strip dấu, lowercase.
 * Nếu OCR text chứa 1 trong các cụm này + heuristic không hard-reject,
 * pipeline sẽ pass dù AI có verdict thấp / lỗi.
 */
const STRONG_RECEIPT_PHRASES = [
  'hoa don ban hang',
  'hoa don gia tri gia tang',
  'hoa don gtgt',
  'hdgtgt',
  'hoa don do',
  'hoa don dien tu',
  'phieu tinh tien',
  'phieu thanh toan',
  'phieu thu',
  'phieu chi',
  'phieu xuat',
  'phieu nhap',
  'phieu giao hang',
  'bien lai',
  'khach phai tra',
  'tong tien hang',
  'tong tien thanh toan',
  'thanh tien',
  'tong cong',
  'ngay ban',
  'ngay lap',
  'invoice no',
  'receipt no',
];

function stripVi(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

/** Phát hiện cụm từ "chắc chắn là bill" trong OCR text. */
function detectStrongReceiptSignal(ocrText: string): {
  strong: boolean;
  matchedPhrase: string | null;
} {
  const stripped = stripVi(ocrText);
  for (const phrase of STRONG_RECEIPT_PHRASES) {
    if (stripped.includes(phrase)) {
      return { strong: true, matchedPhrase: phrase };
    }
  }
  return { strong: false, matchedPhrase: null };
}

/**
 * Heuristic nhanh: không thay LLM nhưng loại bớt ảnh quá lệch (menu, chữ quảng cáo…).
 */
function quickReceiptHeuristic(ocrText: string): {
  score: number;
  noteVi: string;
  hardReject: boolean;
} {
  const text = ocrText.trim();
  if (text.length < 28) {
    return {
      score: 0,
      noteVi: 'Quá ít chữ sau OCR — thường bill có nhiều dòng hơn, hoặc ảnh quá mờ.',
      hardReject: true,
    };
  }
  if (!/\d/.test(text)) {
    return {
      score: 0.05,
      noteVi: 'Không thấy chữ số (giá, SL, mã…) — bill mua hàng hầu như luôn có số.',
      hardReject: true,
    };
  }

  const lower = text.toLowerCase();
  let hits = 0;
  for (const w of RECEIPT_KEYWORDS_VI) {
    if (lower.includes(w)) hits += 1;
  }
  for (const w of RECEIPT_KEYWORDS_EN) {
    if (lower.includes(w)) hits += 1;
  }

  const moneyLike =
    /\b\d{1,3}([.,]\d{3})+\b/.test(text) ||
    /\d+\s*[.,]\s*\d{3}\b/.test(text) ||
    /vnd|đồng|vnđ|dong/i.test(text) ||
    /\d{4,}/.test(text);

  let score = 0.25 + Math.min(0.45, hits * 0.06);
  if (moneyLike) score += 0.15;
  score = Math.min(1, score);

  const noteVi =
    hits < 2 && !moneyLike
      ? 'Ít từ khoá đặc trưng hoá đơn; vẫn có thể là bill — sẽ kiểm tra thêm bằng AI.'
      : 'Có dấu hiệu giống chứng từ mua hàng (từ khoá / số tiền).';

  return { score, noteVi, hardReject: false };
}

@Injectable()
export class BillPipelineService {
  constructor(
    private readonly ocr: OcrService,
    private readonly receiptValidate: ReceiptValidateService,
    private readonly receiptStructure: ReceiptStructureService,
  ) {}

  /**
   * Pipeline đầy đủ: OCR → heuristic/strong-signal gating → AI validate →
   * threshold gating → AI structure. Port nguyên logic từ FE.
   *
   * `imageBase64`: base64 thuần (không có prefix data:image/...).
   */
  async processBill(imageBase64: string): Promise<BillPipelineResult> {
    const ocrText = await this.ocr.extractText(imageBase64);
    if (!ocrText) {
      throw new BadRequestException(
        'Không đọc được chữ từ ảnh. Thử ảnh rõ hơn hoặc đổi góc chụp.',
      );
    }

    const heuristic = quickReceiptHeuristic(ocrText);
    const signal = detectStrongReceiptSignal(ocrText);

    // Hard reject CHỈ khi heuristic chặn cứng VÀ không có cụm từ đặc trưng.
    // Đảm bảo bill rõ ràng (chỉ thiếu nhiều chữ vì cắt ảnh) vẫn được xử lý.
    if (heuristic.hardReject && !signal.strong) {
      throw new BadRequestException(
        `Ảnh có vẻ không phải bill nhập hàng: ${heuristic.noteVi}`,
      );
    }

    // Strong signal → bỏ qua LLM gate luôn (AI đôi khi reject sai do ảnh bị
    // cắt phần dưới, đèn flash, hoặc chữ "HÓA ĐƠN BÁN HÀNG" không khớp template).
    let llmCheck: { isLikelyReceipt: boolean; confidence: number; reasonVi: string };
    try {
      llmCheck = await this.receiptValidate.run(ocrText);
    } catch (e) {
      if (signal.strong) {
        // AI lỗi nhưng OCR có cụm từ chắc chắn → vẫn tiếp tục
        llmCheck = {
          isLikelyReceipt: true,
          confidence: 0.55,
          reasonVi: `AI lỗi, nhưng OCR có cụm "${signal.matchedPhrase}" — vẫn xử lý.`,
        };
      } else {
        throw e;
      }
    }

    const llmPasses = llmCheck.isLikelyReceipt && llmCheck.confidence >= MIN_LLM_CONFIDENCE;
    const strongPasses = signal.strong && heuristic.score >= 0.45;

    if (!llmPasses && !strongPasses) {
      const pct = Math.round(llmCheck.confidence * 100);
      throw new BadRequestException(
        `Không xác định là bill hợp lệ (độ tin cậy ${pct}%). ${llmCheck.reasonVi || 'Thử ảnh rõ hơn hoặc toàn trang hoá đơn.'}`,
      );
    }

    // Pass nhờ strong signal nhưng AI reject → ghi đè reason để UI hiển thị rõ
    if (!llmPasses && strongPasses) {
      llmCheck = {
        isLikelyReceipt: true,
        confidence: Math.max(llmCheck.confidence, 0.55),
        reasonVi: `Có cụm "${signal.matchedPhrase}" — bỏ qua phân loại thấp của AI và xử lý tiếp.`,
      };
    }

    const structured = await this.receiptStructure.run(ocrText);

    // Mặc định ngày bill = hôm nay nếu AI không trích được — luôn có ngày
    // để sort / filter / hiển thị trong list phiếu.
    if (!structured.receiptDate || !/^\d{4}-\d{2}-\d{2}$/.test(structured.receiptDate)) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      structured.receiptDate = `${y}-${m}-${d}`;
    }

    const validation: StockReceiptValidationSnapshot = {
      isLikelyReceipt: llmCheck.isLikelyReceipt,
      confidence: llmCheck.confidence,
      reasonVi: llmCheck.reasonVi,
      heuristicScore: heuristic.score,
      heuristicNoteVi: signal.strong
        ? `${heuristic.noteVi} (Phát hiện cụm: "${signal.matchedPhrase}")`
        : heuristic.noteVi,
    };

    return { ocrText, structured, validation };
  }
}
