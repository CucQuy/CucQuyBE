import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { BillValidationResult, StockReceiptStructured } from './ai.types';

/** 1 NVL đưa vào Claude để gợi ý gộp (chỉ field cần thiết). */
export interface MaterialForMerge {
  id: string;
  name: string;
  canonicalUnit?: string | null;
  importCount: number;
}

/** 1 nhóm NVL Claude cho là CÙNG sản phẩm (nên gộp). */
export interface AiMergeGroup {
  /** id các NVL trong nhóm (≥2). */
  memberIds: string[];
  /** Tên chuẩn Claude đề xuất cho nhóm. */
  suggestedName: string;
  /** Đơn vị chuẩn Claude đề xuất (null nếu không chắc). */
  suggestedUnit: string | null;
  /** Độ tin cậy 0–1. */
  confidence: number;
  /** Lý do ngắn (tiếng Việt) vì sao cùng sản phẩm. */
  reason: string;
}

// Module AI (đọc/cấu trúc bill, gợi ý gộp NVL) chạy trên Claude (Anthropic).
// Tên đặt chung "ai" (không gắn vendor) — route /ai/*.
// Đổi model qua env CLAUDE_MODEL (claude-haiku-4-5 / claude-sonnet-4-6) nếu cần.
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
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

  /**
   * Gợi ý gộp NVL bằng Claude: đưa TOÀN BỘ danh sách tên NVL, Claude gom các mục
   * CÙNG một sản phẩm thật (dù OCR ghi sai / thiếu dấu / viết tắt khác nhau),
   * đồng thời GIỮ RIÊNG các biến thể khác nhau (loại/thương hiệu/quy cách).
   * Trả về mảng nhóm (≥2 thành viên) đã validate id + clamp confidence.
   */
  async suggestMaterialMerges(
    materials: MaterialForMerge[],
  ): Promise<AiMergeGroup[]> {
    if (materials.length < 2) return [];

    // Danh sách gọn: "<id>\t<tên>[ (đơn vị)] [xN lần nhập]" — 1 dòng 1 NVL.
    const list = materials
      .map(
        (m) =>
          `${m.id}\t${m.name}${m.canonicalUnit ? ` (${m.canonicalUnit})` : ''} [x${m.importCount}]`,
      )
      .join('\n');

    const resp = await this.getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: MERGE_SYSTEM_VI,
      messages: [{ role: 'user', content: list.slice(0, 24000) }],
    });

    const parsed = this.parseJson<{ groups?: unknown }>(this.firstText(resp));
    const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
    const validIds = new Set(materials.map((m) => m.id));

    return rawGroups
      .map((g): AiMergeGroup => {
        const r = (g ?? {}) as Record<string, unknown>;
        const memberIds = Array.isArray(r.memberIds)
          ? Array.from(
              new Set(
                (r.memberIds as unknown[]).filter(
                  (id): id is string =>
                    typeof id === 'string' && validIds.has(id),
                ),
              ),
            )
          : [];
        const confidence =
          typeof r.confidence === 'number'
            ? Math.max(0, Math.min(1, r.confidence))
            : 0;
        return {
          memberIds,
          suggestedName: this.normalizeStr(r.suggestedName) ?? '',
          suggestedUnit: this.normalizeStr(r.suggestedUnit),
          confidence,
          reason: this.normalizeStr(r.reason) ?? '',
        };
      })
      .filter((g) => g.memberIds.length >= 2);
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
- PHÂN LOẠI mỗi dòng (itemType) dựa vào TÊN + GIÁ + SỐ LƯỢNG:
  + "material" = nguyên vật liệu tiêu hao (bột, đường, trứng, bơ, hộp, túi, hương liệu... — mua thường xuyên).
  + "asset"    = tài sản dùng lâu (máy, tủ, lò, cân, kệ inox, thiết bị... — giá cao, SL ít, dùng nhiều tháng).
  + "opex"     = chi phí vận hành (tiền điện, nước, internet, thuê mặt bằng, sửa chữa, phí dịch vụ...).
  Không chắc → "material". Kèm confidence (0..1). Nếu "asset": suggestedUsefulMonths (thiết bị ~24, nội thất ~36).
  category gợi ý (asset: equipment|furniture|renovation|other; opex: rent|utilities|internet|maintenance|other).

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
  "lineItems": [{ "name": string, "quantity": number | null, "unit": string | null, "unitPrice": number | null, "lineTotal": number | null, "itemType": "material" | "asset" | "opex", "confidence": number, "suggestedUsefulMonths": number | null, "category": string | null }],
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

const MERGE_SYSTEM_VI = `Bạn là trợ lý kho của một TIỆM BÁNH. Bạn nhận DANH SÁCH nguyên vật liệu (NVL) đã nhập.
Mỗi dòng: "<id><TAB><tên>[ (đơn vị)] [x<số lần nhập>]".

NHIỆM VỤ: Tìm các NVL thực chất là CÙNG MỘT sản phẩm nhưng bị ghi khác nhau (do OCR đọc sai, thiếu/khác dấu, viết tắt, thừa/thiếu khoảng trắng, khác hoa thường, kèm/không kèm quy cách) → gom thành NHÓM để gộp.

NGUYÊN TẮC (RẤT QUAN TRỌNG — thà bỏ sót còn hơn gộp nhầm):
- CHỈ gom khi gần như chắc chắn là cùng một mặt hàng. Nếu phân vân → ĐỪNG gom.
- GIỮ RIÊNG các biến thể KHÁC nhau, KHÔNG gộp:
  • Khác LOẠI/màu/vị: "Đường đen" ≠ "Đường trắng"; "Chocolate trắng" ≠ "Chocolate đen".
  • Khác THƯƠNG HIỆU: "Bơ Anchor" ≠ "Bơ President".
  • Khác QUY CÁCH đóng gói rõ rệt nếu là SKU khác: "Whipping 250ml" ≠ "Whipping 1L" (nhưng "Trứng"/"Trứng gà"/"trứng gà (quả)" thì CÙNG).
- Đơn vị đồng nghĩa coi như giống: cái = quả (với trứng), gói ≈ bịch.
- Mỗi id chỉ thuộc TỐI ĐA 1 nhóm. Nhóm phải có ≥2 thành viên. NVL không trùng ai thì bỏ qua (không tạo nhóm 1 phần tử).

Với mỗi nhóm, đề xuất:
- suggestedName: tên chuẩn, rõ ràng, đúng chính tả tiếng Việt (chọn/soạn từ các tên trong nhóm).
- suggestedUnit: đơn vị chuẩn của nhóm (vd kg, g, ml, gói, hộp, cái, quả…); null nếu không chắc.
- confidence: 0–1 (độ chắc chắn cùng sản phẩm).
- reason: 1 câu tiếng Việt vì sao là cùng sản phẩm.

Trả về DUY NHẤT một JSON hợp lệ (KHÔNG markdown, KHÔNG giải thích ngoài JSON):
{"groups":[{"memberIds":["id1","id2",...],"suggestedName":string,"suggestedUnit":string|null,"confidence":number,"reason":string}]}
Nếu không có nhóm nào đáng gộp: {"groups":[]}

Danh sách NVL nằm trong message của người dùng.`;
