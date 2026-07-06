import { Injectable } from '@nestjs/common';
import { WebhookProc, OrderPaidSummary } from './webhooks.proc';
import { EventsGateway } from '../events/events.gateway';
import { ZaloService } from '../zalo/zalo.service';

/** Service chỉ orchestration + dựng payload HTTP; mọi DB qua WebhookProc. */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly proc: WebhookProc,
    private readonly events: EventsGateway,
    private readonly zalo: ZaloService,
  ) {}

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
      return {
        status: 200,
        payload: {
          success: true,
          message: 'Transaction saved but no matching order',
          transactionId: body.id,
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

  /** Facebook/Fanpage inbox: lưu message, idempotent theo id_new_message. */
  async handleFacebook(body: any): Promise<{ status: number; payload: Record<string, unknown> }> {
    const idNewMessage =
      typeof body?.id_new_message === 'string' ? body.id_new_message.trim() : '';
    if (!body || !idNewMessage) {
      return {
        status: 400,
        payload: { error: 'Invalid webhook data: id_new_message is required' },
      };
    }

    const res = await this.proc.facebookMessage(body);

    return {
      status: 200,
      payload: {
        success: true,
        duplicate: res.duplicate,
        message: res.duplicate ? 'Message already stored' : 'Webhook received',
        id_new_message: idNewMessage,
        docId: res.id,
      },
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
    await this.zalo
      .send({ message: this.buildPaidMessage(orderNumber, amount, tx, summary) })
      .catch(() => undefined);
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
      const parts = items.slice(0, 6).map((it) => `${it.name || '(?)'} ×${it.quantity || 0}`);
      if (items.length > 6) parts.push(`…+${items.length - 6}`);
      lines.push(`📦 ${parts.join(', ')}`);
    }

    lines.push('✅ ĐÃ THANH TOÁN');
    return lines.join('\n');
  }
}
