import { Injectable } from '@nestjs/common';
import { WebhookProc } from './webhooks.proc';
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

  /** Build + gửi noti Zalo auto-PAID (gọn). Không throw ra ngoài. */
  private async buildAndSendPaid(
    orderNumber: string,
    amount: number,
    tx: Record<string, any>,
  ): Promise<void> {
    const groupIds = await this.paymentGroupIds();
    await this.zalo
      .send({
        message: this.buildPaidMessage(orderNumber, amount, tx),
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
   * Nội dung Zalo khi đơn auto-PAID — GỌN: loại (cọc/thanh toán) + mã đơn, số tiền
   * (+ ngân hàng), ngày giờ nhận. Cọc = nội dung CK có prefix "C" (QR cọc: C<mã đơn>).
   */
  private buildPaidMessage(
    orderNumber: string,
    amount: number,
    tx: Record<string, any>,
  ): string {
    const bank = typeof tx.gateway === 'string' ? tx.gateway.trim() : '';
    const time = this.formatTxTime(tx.transaction_date ?? tx.received_at);
    const rawContent =
      typeof tx.content === 'string' ? tx.content
      : typeof tx.description === 'string' ? tx.description : '';
    const norm = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    // QR cọc gắn nội dung "C" + mã đơn → phân biệt cọc vs thanh toán đủ.
    const isDeposit = norm(rawContent).includes('C' + norm(orderNumber));

    const money = [this.formatVND(amount)];
    if (bank) money.push(bank);

    const lines = [`💰 ${isDeposit ? 'CỌC' : 'THANH TOÁN'} · ${orderNumber}`, `💵 ${money.join(' · ')}`];
    if (time) lines.push(`🕒 ${time}`);
    return lines.join('\n');
  }
}
