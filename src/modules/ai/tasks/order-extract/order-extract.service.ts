import { BadRequestException, Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import {
  ORDER_EXTRACT_CONFIG,
  ORDER_EXTRACT_MAX_IMAGES,
} from './order-extract.config';
import {
  OrderExtractCatalogItem,
  OrderExtractImage,
  OrderExtractItem,
  OrderExtracted,
} from './order-extract.types';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'order-extract.prompt.md');

const DELIVERY_TYPES = ['SHIP', 'PICKUP', 'SHIP_PROVINCE', 'DINE_IN'] as const;
const PAYMENT_METHODS = ['CASH', 'BANKING'] as const;
const PAYMENT_STATUSES = ['PAID', 'UNPAID', 'DEPOSITED'] as const;

/** Bỏ dấu + lowercase để so tên sản phẩm (AI/khách hay viết thiếu dấu). */
function stripVi(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ngày hôm nay theo giờ VN (yyyy-mm-dd) — mốc quy đổi "mai", "thứ 7 này"… */
function todayVN(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Thứ trong tuần của 1 ngày yyyy-mm-dd (tiếng Việt) — giúp AI hiểu "chủ nhật này". */
function weekdayVN(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][day];
}

/**
 * Nghiệp vụ: quét ảnh khách đặt hàng (chat/giấy ghi tay) → dữ liệu điền sẵn form
 * tạo đơn. AI chỉ GỢI Ý — người vẫn soát lại trong form trước khi lưu.
 */
@Injectable()
export class OrderExtractService {
  constructor(private readonly ai: AiClientService) {}

  async run(
    images: OrderExtractImage[],
    catalog: OrderExtractCatalogItem[],
  ): Promise<OrderExtracted> {
    const imgs = images
      .filter((i) => typeof i?.base64 === 'string' && i.base64.length > 0)
      .slice(0, ORDER_EXTRACT_MAX_IMAGES);
    if (imgs.length === 0) {
      throw new BadRequestException('Chưa có ảnh đơn để quét.');
    }

    const raw = await this.ai.completeWithImages(
      ORDER_EXTRACT_CONFIG,
      SYSTEM_PROMPT,
      imgs,
      this.buildUserText(catalog),
    );
    const parsed = this.ai.parseJson<Record<string, unknown>>(raw);
    return this.normalize(parsed, catalog);
  }

  /** Phần text đi kèm ảnh: mốc ngày hôm nay + danh mục sản phẩm để AI map id. */
  private buildUserText(catalog: OrderExtractCatalogItem[]): string {
    const lines = catalog.map((p) => {
      const sizes = p.sizes?.length ? ` | size: ${p.sizes.join(', ')}` : '';
      const flavors = p.flavors?.length ? ` | vị: ${p.flavors.join(', ')}` : '';
      return `- id=${p.id} | ${p.name} | ${p.price}đ${sizes}${flavors}`;
    });
    const today = todayVN();
    return [
      `NGÀY HÔM NAY: ${today} (${weekdayVN(today)}, giờ Việt Nam).`,
      '',
      'DANH MỤC SẢN PHẨM (chỉ được dùng id trong danh sách này):',
      lines.length ? lines.join('\n') : '(trống)',
      '',
      'Hãy đọc (các) ảnh đính kèm và trả JSON theo đúng schema đã mô tả.',
    ].join('\n');
  }

  /** Chuẩn hoá + chặn AI bịa: id phải có thật, enum phải hợp lệ, số phải là số. */
  private normalize(
    raw: Record<string, unknown>,
    catalog: OrderExtractCatalogItem[],
  ): OrderExtracted {
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const byName = new Map(catalog.map((p) => [stripVi(p.name), p]));

    const items = Array.isArray(raw.items) ? raw.items : [];
    const warnings = Array.isArray(raw.warningsVi)
      ? raw.warningsVi.filter((w): w is string => typeof w === 'string')
      : [];

    const normalizedItems: OrderExtractItem[] = items
      .map((it) => this.normalizeItem(it, byId, byName))
      .filter((it): it is OrderExtractItem => it !== null);

    return {
      customerName: this.ai.normalizeStr(raw.customerName),
      phone: this.normalizePhone(this.ai.normalizeStr(raw.phone)),
      address: this.ai.normalizeStr(raw.address),
      deliveryDate: this.normalizeDate(this.ai.normalizeStr(raw.deliveryDate)),
      deliveryTime: this.normalizeTime(this.ai.normalizeStr(raw.deliveryTime)),
      deliveryType: this.pickEnum(raw.deliveryType, DELIVERY_TYPES),
      paymentMethod: this.pickEnum(raw.paymentMethod, PAYMENT_METHODS),
      paymentStatus: this.pickEnum(raw.paymentStatus, PAYMENT_STATUSES),
      depositAmount: this.normalizeMoney(raw.depositAmount),
      shippingCost: this.normalizeMoney(raw.shippingCost),
      note: this.ai.normalizeStr(raw.note),
      items: normalizedItems,
      confidence:
        typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
          ? raw.confidence
          : 0.5,
      warningsVi: warnings,
    };
  }

  private normalizeItem(
    input: unknown,
    byId: Map<string, OrderExtractCatalogItem>,
    byName: Map<string, OrderExtractCatalogItem>,
  ): OrderExtractItem | null {
    if (!input || typeof input !== 'object') return null;
    const it = input as Record<string, unknown>;
    const productName = this.ai.normalizeStr(it.productName);
    if (!productName) return null;

    // Id AI trả phải CÓ THẬT trong danh mục; không thì thử khớp theo tên (bỏ dấu).
    const rawId = this.ai.normalizeStr(it.productId);
    const product =
      (rawId && byId.get(rawId)) || byName.get(stripVi(productName)) || null;

    const quantity = Math.max(1, Math.round(Number(it.quantity) || 1));
    const size = this.ai.normalizeStr(it.size);
    const flavors = Array.isArray(it.flavors)
      ? it.flavors.filter((f): f is string => typeof f === 'string' && !!f.trim())
      : [];

    return {
      productId: product?.id ?? null,
      productName,
      quantity,
      // Chỉ giữ size khớp đúng danh mục của SP đó (tránh form nhận size lạ).
      size:
        size && product?.sizes?.some((s) => stripVi(s) === stripVi(size))
          ? (product.sizes.find((s) => stripVi(s) === stripVi(size)) ?? null)
          : null,
      flavors,
      unitPrice: this.normalizeMoney(it.unitPrice),
      note: this.ai.normalizeStr(it.note),
    };
  }

  /** Số tiền VND: chỉ nhận number dương hợp lệ, còn lại null. */
  private normalizeMoney(v: unknown): number | null {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
  }

  /** SĐT VN: bỏ ký tự phân cách, giữ lại nếu còn đúng dạng số. */
  private normalizePhone(v: string | null): string | null {
    if (!v) return null;
    const digits = v.replace(/[\s.\-()]/g, '');
    return /^\+?\d{8,15}$/.test(digits) ? digits : v;
  }

  /** Chỉ nhận yyyy-mm-dd hợp lệ. */
  private normalizeDate(v: string | null): string | null {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return Number.isNaN(Date.parse(v)) ? null : v;
  }

  /** Chỉ nhận HH:mm (24h). */
  private normalizeTime(v: string | null): string | null {
    if (!v) return null;
    const m = v.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  /** Giá trị enum AI trả — không thuộc tập hợp lệ thì null. */
  private pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
    return typeof v === 'string' && (allowed as readonly string[]).includes(v)
      ? (v as T)
      : null;
  }
}
