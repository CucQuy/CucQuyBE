import { Injectable } from '@nestjs/common';
import { WebhookProc, OrderPaidSummary, OrderPaidItem } from './webhooks.proc';
import { EventsGateway } from '../events/events.gateway';
import { ZaloService } from '../zalo/zalo.service';
import { ConfigurationsService } from '../configurations/configurations.service';

/** Service chỉ orchestration + dựng payload HTTP; mọi DB qua WebhookProc. */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly proc: WebhookProc,
    private readonly events: EventsGateway,
    private readonly zalo: ZaloService,
    private readonly config: ConfigurationsService,
  ) {}

  /**
   * Group Zalo đích cho thông báo THANH TOÁN = các nhóm có cờ notifyOnPayment
   * (cấu hình theo từng nhóm ở Cài đặt Zalo). Fallback: paymentGroupId (config cũ)
   * → undefined (ZaloService dùng env). Tách khỏi nhóm đơn hàng.
   */
  private async paymentGroupIds(): Promise<string[] | undefined> {
    try {
      const cfg = await this.config.fetchZaloGroupsConfiguration();
      const fromGroups = (cfg.groups ?? [])
        .filter((g) => g.notifyOnPayment === true)
        .map((g) => (g.zaloGroupId ?? '').trim())
        .filter(Boolean);
      if (fromGroups.length > 0) return [...new Set(fromGroups)];
      const legacy = (cfg.paymentGroupId ?? '').trim();
      return legacy ? [legacy] : undefined;
    } catch {
      return undefined;
    }
  }

  /** SePay: lưu transaction + (nếu khớp orderNumber) set order = PAID. */
  async handleSepay(body: any): Promise<{ status: number; payload: Record<string, unknown> }> {
    if (!body || !body.id) {
      return { status: 400, payload: { error: 'Invalid webhook data' } };
    }

    const res = await this.proc.sepay(body);

    if (res.duplicate) {
      return {
        status: 200,
        payload: { success: true, duplicate: true, transactionId: body.id },
      };
    }
    if (!res.orderMatched) {
      // ≥2 đơn cùng số tiền (khớp theo số tiền bị nhập nhằng) → không auto-PAID.
      // Bắn Zalo cảnh báo để admin vào màn đối soát xử lý tay (fire-and-forget).
      if (res.needsReview) {
        const tx = (res.transaction ?? {}) as Record<string, any>;
        const amount = Number(tx.transfer_amount) || 0;
        void this.buildAndSendReview(amount, res.ambiguousCount ?? 0, tx);
      }
      return {
        status: 200,
        payload: {
          success: true,
          message: res.needsReview
            ? 'Transaction saved, multiple orders match amount — needs manual reconcile'
            : 'Transaction saved but no matching order',
          transactionId: body.id,
          needsReview: res.needsReview ?? false,
        },
      };
    }
    // Đơn vừa được auto-PAID (giao dịch tiền vào khớp mã đơn) → bắn realtime
    // toast cho Owner/Admin đang online. transaction = to_jsonb(transactions) (snake_case).
    const tx = (res.transaction ?? {}) as Record<string, any>;
    if (res.orderNumber) {
      const amount = Number(tx.transfer_amount) || 0;
      this.events.emitOrderPaid({ orderNumber: res.orderNumber, amount });
      // Bắn Zalo nhóm (fire-and-forget — không chặn response webhook). Lỗi bỏ qua.
      void this.buildAndSendPaid(res.orderNumber, amount, tx);
    }

    return {
      status: 200,
      payload: { success: true, message: 'Webhook received', transactionId: body.id },
    };
  }

  /** VND kiểu Việt Nam (250.000 ₫) — khớp formatVND của FE để noti đồng nhất. */
  private formatVND(amount: number): string {
    try {
      return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
    } catch {
      return `${amount.toLocaleString('vi-VN')} ₫`;
    }
  }

  /** Thời gian GD dạng dd/MM/yy HH:mm (giờ VN). '' nếu thiếu/không parse được. */
  private formatTxTime(raw: unknown): string {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    // en-GB cho ra dd/MM/yy, HH:mm ổn định (vi-VN đảo giờ/ngày khi format lẻ).
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(d)
      .replace(', ', ' ');
  }

  /** Lấy tóm tắt đơn rồi build + gửi noti Zalo auto-PAID. Không throw ra ngoài. */
  private async buildAndSendPaid(
    orderNumber: string,
    amount: number,
    tx: Record<string, any>,
  ): Promise<void> {
    let summary: OrderPaidSummary | null = null;
    try {
      summary = await this.proc.orderPaidSummary(orderNumber);
    } catch {
      // Không lấy được chi tiết đơn → vẫn gửi noti gọn (chỉ số tiền/ngân hàng).
    }
    const groupIds = await this.paymentGroupIds();
    await this.zalo
      .send({
        message: this.buildPaidMessage(orderNumber, amount, tx, summary),
        ...(groupIds ? { groupIds } : {}),
      })
      .catch(() => undefined);
  }

  /** Cảnh báo Zalo khi nhận tiền nhưng ≥2 đơn cùng số tiền → cần đối soát tay. */
  private async buildAndSendReview(
    amount: number,
    ambiguousCount: number,
    tx: Record<string, any>,
  ): Promise<void> {
    const bank = typeof tx.gateway === 'string' ? tx.gateway.trim() : '';
    const time = this.formatTxTime(tx.transaction_date ?? tx.received_at);
    const money = [this.formatVND(amount)];
    if (bank) money.push(bank);
    if (time) money.push(time);
    const message = [
      '⚠️ NHẬN TIỀN CẦN ĐỐI SOÁT',
      '─────────────────────────',
      `💵 ${money.join(' · ')}`,
      `🔎 ${ambiguousCount} đơn cùng số tiền — không tự khớp được`,
      '👉 Vào màn Giao dịch để đối soát thủ công',
    ].join('\n');
    const groupIds = await this.paymentGroupIds();
    await this.zalo.send({ message, ...(groupIds ? { groupIds } : {}) }).catch(() => undefined);
  }

  /**
   * Nội dung Zalo khi đơn được auto-PAID — khối gọn, dễ quét: khách + số tiền/ngân
   * hàng/giờ trên 1 dòng + danh sách món. Field thiếu thì bỏ dòng, không hiện trống.
   */
  private buildPaidMessage(
    orderNumber: string,
    amount: number,
    tx: Record<string, any>,
    summary: OrderPaidSummary | null,
  ): string {
    const DIVIDER = '─────────────────────────';
    const bank = typeof tx.gateway === 'string' ? tx.gateway.trim() : '';
    const time = this.formatTxTime(tx.transaction_date ?? tx.received_at);
    const name = summary?.customerName?.trim() ?? '';
    const phone = summary?.phone?.trim() ?? '';
    const items = Array.isArray(summary?.items) ? summary!.items! : [];

    const lines = [`💰 ĐÃ NHẬN THANH TOÁN · ${orderNumber}`, DIVIDER];
    if (name || phone) lines.push(`👤 ${[name, phone].filter(Boolean).join(' · ')}`);

    const money = [this.formatVND(amount)];
    if (bank) money.push(bank);
    if (time) money.push(time);
    lines.push(`💵 ${money.join(' · ')}`);

    if (items.length) {
      lines.push('📦 Sản phẩm:');
      items.forEach((it) => this.itemLines(it).forEach((l) => lines.push(l)));
    }

    lines.push('✅ ĐÃ THANH TOÁN');
    return lines.join('\n');
  }

  /** Gom vị (có lặp) → "4 socola, 3 matcha" (số lượng trước). '' nếu không có. */
  private flavorsDetail(flavors?: string[] | null): string {
    if (!Array.isArray(flavors) || !flavors.length) return '';
    const m = new Map<string, number>();
    flavors.forEach((f) => m.set(f, (m.get(f) || 0) + 1));
    return Array.from(m.entries())
      .map(([n, q]) => `${q} ${n}`)
      .join(', ');
  }

  /**
   * Các dòng hiển thị 1 món (cấu trúc phân cấp, khớp FE): • tên → mỗi size "- Tên: SL n"
   * → "Chi tiết (vị...)" nếu có vị. Món không có size → gộp "· SL n" vào dòng tên.
   */
  private itemLines(it: OrderPaidItem): string[] {
    const out: string[] = [];
    const scs = (it.sizeCounts ?? []).filter((x) => (x?.qty || 0) > 0);
    const qty = it.quantity || 0;
    if (scs.length > 0) {
      out.push(`• ${it.name || '(?)'}`);
      scs.forEach((sc) => out.push(`- ${sc.name}: SL ${sc.qty}`));
    } else if (it.size) {
      out.push(`• ${it.name || '(?)'} · ${it.size}${qty > 1 ? ` · SL ${qty}` : ''}`);
    } else {
      out.push(`• ${it.name || '(?)'}${qty > 1 ? ` · SL ${qty}` : ''}`);
    }
    const fl = this.flavorsDetail(it.flavors);
    if (fl) out.push(`Chi tiết (${fl})`);
    return out;
  }
}
