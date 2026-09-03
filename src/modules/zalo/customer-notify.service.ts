import { Injectable, Logger } from '@nestjs/common';
import { ZaloProc, type CustomerNotifyInfo } from './zalo.proc';
import { ZaloService, toZaloNumber } from './zalo.service';

/** Lý do KHÔNG gửi được — FE hiện toast đúng nguyên nhân thay vì "thất bại". */
export type SkipReason =
  | 'disabled'
  | 'no_order'
  | 'no_phone'
  | 'opt_out'
  | 'already_sent'
  | 'daily_limit'
  | 'test_order';

export interface NotifyResult {
  sent: boolean;
  reason?: SkipReason;
  notifiedAt?: string;
}

/** Nhãn trạng thái giao hàng cho KHÁCH đọc (BE không có map này, FE để trong i18n). */
const DELIVERY_LABEL: Record<string, string> = {
  SHIP: 'Giao nội thành',
  SHIP_PROVINCE: 'Gửi tỉnh',
  PICKUP: 'Khách qua lấy',
  DINE_IN: 'Dùng tại tiệm',
};

const SHOP_NAME = 'Tiệm Bánh Cúc Quy';
const DIVIDER = '━━━━━━━━━━━━━━━';

/** dd/mm từ 'yyyy-mm-dd' (đơn lưu date-only) — sai định dạng thì trả nguyên chuỗi. */
const dmy = (iso?: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}` : String(iso ?? '');
};

const vnd = (n: number): string => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;

/**
 * Gửi tin Zalo CÁ NHÂN cho KHÁCH sau khi đặt hàng: cảm ơn + thông tin đơn +
 * link tự tra trạng thái + mã khuyến mãi lần sau + số liên hệ tiệm.
 *
 * Vì đây là gửi cho NGƯỜI LẠ (bridge Abit giới hạn tin lạ + kết bạn/ngày, gửi dồn là
 * bị chặn IP) nên mọi lần gửi đều qua các cổng chặn: bật/tắt ở Cài đặt, có SĐT, khách
 * chưa opt-out, chưa gửi cho đơn này, còn hạn mức/ngày. Tin được RẢI qua BullMQ delay.
 */
@Injectable()
export class CustomerNotifyService {
  private readonly logger = new Logger(CustomerNotifyService.name);
  /** Mốc thời gian job cuối đã xếp — dùng để rải tin cách nhau ~30s. */
  private lastScheduledAt = 0;

  constructor(
    private readonly proc: ZaloProc,
    private readonly zalo: ZaloService,
  ) {}

  private link(token: string): string {
    const base = (process.env.FE_SITE_URL || 'https://admin.cucquy.site').replace(/\/+$/, '');
    return `${base}/don/${token}`;
  }

  private shopPhone(): string {
    const raw = String(process.env.ZALO_SENDER_NUMBER || '84349049567').replace(/\D/g, '');
    return raw.startsWith('84') ? `0${raw.slice(2)}` : raw;
  }

  /** Nội dung tin gửi khách. Tách riêng để Cài đặt xem trước được. */
  buildMessage(info: CustomerNotifyInfo, token: string, promoCode: string): string {
    const lines: string[] = [];
    lines.push(`Cảm ơn bạn đã đặt hàng tại ${SHOP_NAME}! 🍰`);
    lines.push(DIVIDER);
    lines.push(`Đơn: ${info.orderNumber}`);
    for (const it of info.items ?? []) {
      lines.push(`• ${it.name} × ${it.quantity}`);
    }
    lines.push(`Tổng: ${vnd(info.total)}`);
    if ((Number(info.paidAmount) || 0) > 0 && info.paidAmount < info.total) {
      lines.push(`Đã cọc: ${vnd(info.paidAmount)} · Còn lại: ${vnd(info.total - info.paidAmount)}`);
    }
    const when = [dmy(info.deliveryDate), info.deliveryTime ?? ''].filter(Boolean).join(' ');
    const how = DELIVERY_LABEL[info.deliveryType] ?? '';
    if (when || how) lines.push(`Giao: ${[when, how].filter(Boolean).join(' · ')}`);
    if (token) lines.push(`Theo dõi đơn: ${this.link(token)}`);
    if (promoCode) lines.push(`🎁 Lần sau nhập mã ${promoCode} để được giảm giá`);
    lines.push(`📞 Liên hệ tiệm: ${this.shopPhone()}`);
    return lines.join('\n');
  }

  /**
   * Gửi tin cho khách của 1 đơn.
   * `force` (nút bấm tay) bỏ qua cổng "đã gửi" + "đơn test", vẫn giữ hạn mức/ngày và opt-out.
   */
  async notifyOrder(orderId: string, force = false): Promise<NotifyResult> {
    const cfg = await this.proc.customerNotifyConfig();
    if (!cfg.enabled && !force) return { sent: false, reason: 'disabled' };

    const info = await this.proc.orderNotifyInfo(orderId);
    if (!info) return { sent: false, reason: 'no_order' };

    if (!toZaloNumber(info.phone)) return { sent: false, reason: 'no_phone' };
    if (info.optOut) return { sent: false, reason: 'opt_out' };
    if (!force && info.notifiedAt) {
      return { sent: false, reason: 'already_sent', notifiedAt: info.notifiedAt };
    }
    if (!force && info.isTest) return { sent: false, reason: 'test_order' };
    if (cfg.sentToday >= cfg.dailyLimit) return { sent: false, reason: 'daily_limit' };

    const token = await this.proc.ensurePublicToken(orderId);
    const message = this.buildMessage(info, token, cfg.promoCode);

    // Rải tin: mỗi tin cách nhau ≥30s, tối đa dồn 15 phút (quá thì gửi ngay để không treo mãi).
    const now = Date.now();
    const base = Math.max(now, this.lastScheduledAt + 30_000);
    const delayMs = Math.min(base - now, 15 * 60_000);
    this.lastScheduledAt = now + delayMs;

    await this.zalo.send(
      { message, toNumbers: [info.phone], category: 'customer_order' },
      { delayMs },
    );
    await this.proc.markCustomerNotified(orderId);
    this.logger.log(
      `Xếp gửi Zalo cho khách đơn ${info.orderNumber} (sau ${Math.round(delayMs / 1000)}s)`,
    );
    return { sent: true };
  }

  /** Hook sau khi TẠO đơn — fire-and-forget, không chặn luồng tạo đơn. */
  onOrderCreated(orderId: string): void {
    void this.notifyOrder(orderId, false).catch((err) => {
      this.logger.warn(`Gửi Zalo cho khách (đơn ${orderId}) lỗi: ${String(err)}`);
    });
  }

  /** Xem trước nội dung tin ở Cài đặt (dữ liệu giả, không gửi gì). */
  async previewMessage(): Promise<{ message: string; promoCode: string }> {
    const cfg = await this.proc.customerNotifyConfig();
    const demo: CustomerNotifyInfo = {
      orderNumber: 'ORD-000712',
      customerName: 'Nguyễn Văn A',
      phone: '0912345678',
      isTest: false,
      notifiedAt: null,
      optOut: false,
      deliveryDate: '2026-09-05',
      deliveryTime: '14:00',
      deliveryType: 'SHIP',
      total: 350000,
      paidAmount: 100000,
      items: [
        { name: 'Bánh kem dâu', quantity: 1 },
        { name: 'Bánh mì hoa cúc', quantity: 2 },
      ],
    };
    return {
      message: this.buildMessage(demo, 'xemtruoc', cfg.promoCode),
      promoCode: cfg.promoCode,
    };
  }
}
