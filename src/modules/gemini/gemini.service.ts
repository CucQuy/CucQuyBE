import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { BillValidationResult, StockReceiptStructured } from './gemini.types';

// LLM đọc bill đã chuyển sang Claude (Anthropic). Tên class/route giữ "gemini"
// làm hợp đồng API với frontend (services/geminiService.ts gọi /gemini/...).
// Đổi model qua env CLAUDE_MODEL (claude-haiku-4-5 / claude-sonnet-4-6) nếu cần.
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY is not set in the environment.');
      throw new Error('Thiếu ANTHROPIC_API_KEY trong môi trường.');
    }
    if (!this.client) this.client = new Anthropic({ apiKey });
    return this.client;
  }

  /** Lấy text từ block đầu tiên của response. */
  private firstText(resp: Anthropic.Message): string {
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('Claude không trả về nội dung text.');
    }
    return block.text;
  }

  /** Parse JSON bền: bỏ ```json fence, hoặc cắt từ '{' đến '}' nếu lẫn chữ thừa. */
  private parseJson<T>(raw: string): T {
    let s = raw.trim();
    const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fence) s = fence[1].trim();
    try {
      return JSON.parse(s) as T;
    } catch {
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1)) as T;
      throw new Error('Claude trả về không phải JSON hợp lệ.');
    }
  }

  private normalizeStr(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t : null;
  }

  async validateReceipt(ocrText: string): Promise<BillValidationResult> {
    const resp = await this.getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      system: VALIDATE_SYSTEM_VI,
      messages: [{ role: 'user', content: ocrText.slice(0, 8000) }],
    });

    const p = this.parseJson<Record<string, unknown>>(this.firstText(resp));
    return {
      isLikelyReceipt: Boolean(p.isLikelyReceipt ?? p.isLikelyPurchaseReceipt),
      confidence:
        typeof p.confidence === 'number'
          ? Math.max(0, Math.min(1, p.confidence))
          : 0,
      reasonVi:
        typeof p.reasonVi === 'string' ? p.reasonVi : String(p.reason ?? ''),
    };
  }

  async structureStockReceipt(ocrText: string): Promise<StockReceiptStructured> {
    const resp = await this.getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: STRUCTURE_SYSTEM_VI,
      messages: [{ role: 'user', content: ocrText.slice(0, 12000) }],
    });

    const parsed = this.parseJson<Partial<StockReceiptStructured>>(
      this.firstText(resp),
    );
    if (!Array.isArray(parsed.lineItems)) parsed.lineItems = [];

    parsed.supplierName = this.normalizeStr(parsed.supplierName);
    parsed.supplierPhone = this.normalizeStr(parsed.supplierPhone);
    parsed.supplierAddress = this.normalizeStr(parsed.supplierAddress);
    parsed.invoiceNumber = this.normalizeStr(parsed.invoiceNumber);

    // Chuẩn hoá SĐT NCC (giữ logic cũ).
    if (parsed.supplierPhone) {
      const onlyDigitsPlus = parsed.supplierPhone.replace(/[\s.\-()]/g, '');
      parsed.supplierPhone = /^\+?\d{8,15}$/.test(onlyDigitsPlus)
        ? onlyDigitsPlus
        : parsed.supplierPhone;
    }

    return parsed as StockReceiptStructured;
  }
}

const VALIDATE_SYSTEM_VI = `Bạn kiểm tra nội dung OCR có phải chứng từ MUA HÀNG / BÁN HÀNG (hoá đơn, phiếu tính tiền, biên lai siêu thị, phiếu NCC, phiếu bán lẻ của shop…) hay không.

Trả về DUY NHẤT một JSON (không markdown, không giải thích):
{"isLikelyReceipt": boolean, "confidence": number từ 0 đến 1, "reasonVi": string ngắn (tối đa 2 câu, tiếng Việt)}

HỢP LỆ — confidence >= 0.6, kể cả khi ảnh bị cắt mất phần dưới hoặc thiếu tổng tiền:
- Có TIÊU ĐỀ tiêu biểu: "HÓA ĐƠN BÁN HÀNG", "HÓA ĐƠN GTGT", "HOÁ ĐƠN", "Phiếu tính tiền", "Phiếu thu", "Biên lai", "Receipt", "Invoice".
- HOẶC có >= 1 mặt hàng + giá / số lượng (cột SL, ĐG, Thành tiền, Đơn giá…).
- HOẶC có cụm "Khách phải trả", "Tổng tiền hàng", "Tổng cộng", "Ngày bán", "Ngày lập".
- Phiếu nhỏ của shop tự in (chỉ vài dòng) VẪN hợp lệ — đừng đòi đầy đủ trường.

KHÔNG HỢP LỆ — confidence < 0.3:
- Ảnh chân dung / selfie / phong cảnh / sản phẩm rời.
- Menu nhà hàng / catalogue không có giá.
- Screenshot chat, bài báo, danh thiếp, slide, meme.
- Màn hình app không liên quan thanh toán.

Khi không chắc nhưng có dấu hiệu giống bill (chữ số tiền + tên sản phẩm) → confidence ~ 0.5–0.6, isLikelyReceipt = true, không reject vội.

Nội dung OCR nằm trong message của người dùng.`;

const STRUCTURE_SYSTEM_VI = `Bạn là trợ lý kế toán kho. Nhiệm vụ: làm sạch và cấu trúc hoá dữ liệu từ chữ đã OCR của một hoá đơn/phiếu mua hàng (nhập hàng).

Quy tắc chung:
- Trả về DUY NHẤT một JSON hợp lệ, KHÔNG markdown, KHÔNG giải thích.
- Số tiền: số thuần (number), không chuỗi. Không chắc thì null.
- Ngày: ưu tiên yyyy-mm-dd; nếu chỉ có dd/mm/yyyy hãy chuyển sang yyyy-mm-dd; không đoán bừa thì null.
- productLineCount = số dòng mặt hàng (sản phẩm) bạn trích được.
- currency: mặc định "VND" nếu bill VN.
- lineItems: mỗi phần tử có name (bắt buộc), quantity, unit (kg, thùng, chai...), unitPrice, lineTotal.

QUY TẮC TRÍCH XUẤT THÔNG TIN NCC (BẮT BUỘC CỐ GẮNG):

1) supplierPhone — số điện thoại của NCC / cửa hàng (không phải SĐT khách).
   - Bắt sau các nhãn: "ĐT", "Đ.T", "SĐT", "Điện thoại", "Tel", "Tel.", "Phone",
     "Hotline", "Liên hệ", "DT", "MB" (di động), "Mobile", "Fax" (không lấy fax).
   - Pattern VN: bắt đầu 0|+84 + 9–10 chữ số. Có thể có dấu cách / chấm / gạch.
   - Chuẩn hoá: bỏ ký tự ".-() " để chỉ còn chữ số + dấu "+" đầu nếu có.
   - Nếu có nhiều SĐT, lấy SĐT đầu tiên ở phần header của bill.

2) supplierAddress — địa chỉ NCC (KHÁC với "storeOrBranch" là tên chi nhánh).
   - Bắt sau các nhãn: "Địa chỉ", "Đ/C", "ĐC", "Address", "Add", "Tại", "Trụ sở".
   - Lấy nguyên 1 dòng địa chỉ (gộp tối đa 2 dòng nếu có "Số nhà / đường" và "Phường/Quận/TP" tách dòng).
   - Bỏ chấm/dấu hai chấm sau nhãn.

3) invoiceNumber — mã / số hoá đơn (mã chứng từ).
   - Bắt sau các nhãn: "Số HĐ", "Số hoá đơn", "Hoá đơn số", "HĐGTGT", "Mã HĐ",
     "Số phiếu", "Phiếu số", "No.", "No:", "Number", "Mẫu số" (lấy phần "Ký hiệu" cùng số).
   - Có thể dạng: HD-12345, HĐ 00001234, 00012345, 2C24TPB/000123, B-2024-00045…
   - Giữ nguyên định dạng gốc, viết HOA chữ cái.
   - Nếu chỉ có ngày + thời gian mà không có số riêng, để null.

4) supplierName: lấy đoạn TÊN ngắn (công ty / siêu thị / cửa hàng) — KHÔNG đính kèm địa chỉ/SĐT.

5) storeOrBranch: dùng cho tên chi nhánh ("Chi nhánh Q.10", "CN Hà Đông"…) — KHÔNG dùng cho địa chỉ.

Trả về JSON đúng các key sau:
{
  "supplierName": string | null,
  "supplierPhone": string | null,
  "supplierAddress": string | null,
  "invoiceNumber": string | null,
  "storeOrBranch": string | null,
  "receiptDate": string | null,
  "receiptTime": string | null,
  "lineItems": [{ "name": string, "quantity": number | null, "unit": string | null, "unitPrice": number | null, "lineTotal": number | null }],
  "productLineCount": number,
  "subtotal": number | null,
  "tax": number | null,
  "discount": number | null,
  "totalAmount": number | null,
  "currency": string,
  "paymentMethod": string | null,
  "notes": string | null
}

Nội dung OCR nằm trong message của người dùng.`;
