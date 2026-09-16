import { Injectable, Logger } from '@nestjs/common';
import { WebhookProc, type SepayResult } from './webhooks.proc';
import { EventsGateway } from '../events/events.gateway';
import { ZaloService } from '../zalo/zalo.service';
import { ConfigurationsService } from '../configurations/configurations.service';

/** Service chỉ orchestration + dựng payload HTTP; mọi DB qua WebhookProc. */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly proc: WebhookProc,
    private readonly events: EventsGateway,
    private readonly zalo: ZaloService,
    private readonly config: ConfigurationsService,
  ) {}

  /**
   * SePay: lưu transaction + (nếu khớp orderNumber) cộng tiền vào đơn.
   *
   * Mọi giao dịch của tài khoản trong `SEPAY_NOTIFY_ACCOUNTS` đều được báo Zalo —
   * trước đây chỉ đơn auto-PAID mới có tin, nên tiền RA và tiền vào không khớp đơn
   * đi qua hoàn toàn im lặng.
   */
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

    const tx = (res.transaction ?? {}) as Record<string, any>;
    const amount = Number(tx.transfer_amount) || 0;

    // Tiền RA: không bao giờ khớp đơn (webhook_sepay gate transfer_type='in'), nhưng
    // vẫn phải báo — chủ tiệm cần biết tài khoản vừa bị trừ tiền.
    if (res.transferType === 'out') {
      void this.sendZalo(this.buildOutgoingMessage(amount, tx), tx);
      return {
        status: 200,
        payload: { success: true, message: 'Outgoing transaction saved', transactionId: body.id },
      };
    }

    if (!res.orderMatched) {
      // ≥2 đơn cùng số tiền → cần đối soát tay; 0 đơn → tiền về mà chưa rõ của ai.
      void this.sendZalo(
        res.needsReview
          ? this.buildReviewMessage(amount, res.ambiguousCount ?? 0, tx)
          : this.buildUnmatchedInMessage(amount, tx),
        tx,
      );
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

    // Đơn vừa được cộng tiền → bắn realtime toast cho Owner/Admin đang online.
    // transaction = to_jsonb(transactions) (snake_case).
    if (res.orderNumber) {
      this.events.emitOrderPaid({ orderNumber: res.orderNumber, amount });
      void this.sendZalo(this.buildPaidMessage(res.orderNumber, amount, tx, res), tx);
    }

    return {
      status: 200,
      payload: { success: true, message: 'Webhook received', transactionId: body.id },
    };
  }

  /**
   * Tài khoản ngân hàng được phép bắn Zalo (env `SEPAY_NOTIFY_ACCOUNTS`, ngăn cách dấu phẩy).
   * Trống = bắn tất cả — SePay đẩy webhook của MỌI tài khoản đã đăng ký (kể cả TK cũ,
   * TK test), nên không lọc là nhóm Zalo nhận cả những thứ không liên quan tới tiệm.
   */
  private notifyAccounts(): string[] {
    return String(process.env.SEPAY_NOTIFY_ACCOUNTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * Chỉ quyết định CÓ BÁO ZALO HAY KHÔNG — giao dịch vẫn được ghi và vẫn khớp đơn
   * bình thường dù tài khoản không nằm trong danh sách.
   */
  private shouldNotify(tx: Record<string, any>): boolean {
    const allowed = this.notifyAccounts();
    if (allowed.length === 0) return true;
    const acc = String(tx.account_number ?? '').trim();
    return allowed.includes(acc);
  }

  /**
   * Gửi vào nhóm nhận thông báo THANH TOÁN (feature 'payment' — Cài đặt Zalo → Nhóm).
   * Fire-and-forget: webhook SePay không được chờ Zalo, và Zalo lỗi không được làm
   * hỏng việc đã ghi giao dịch.
   */
  private async sendZalo(message: string, tx: Record<string, any>): Promise<void> {
    if (!this.shouldNotify(tx)) {
      this.logger.log(
        `Bỏ qua noti Zalo: tài khoản ${String(tx.account_number ?? '?')} không nằm trong SEPAY_NOTIFY_ACCOUNTS`,
      );
      return;
    }
    await this.zalo.send({ message, feature: 'payment' }).catch(() => undefined);
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

  // ── Mảnh dùng chung cho mọi tin ──────────────────────────
  /** Tiêu đề: gắn [TEST] cho giao dịch vào TK test để không lẫn với tiền thật. */
  private title(text: string, tx: Record<string, any>): string {
    return tx.is_test === true ? `[TEST] ${text}` : text;
  }

  /**
   * '💵 250.000 ₫ · MBBank'. `sign='-'` cho tiền ra để liếc qua là biết bị trừ,
   * không phải đọc tiêu đề mới hiểu. Ngân hàng bỏ qua nếu SePay không gửi.
   */
  private moneyLine(amount: number, tx: Record<string, any>, sign: '' | '-' = ''): string {
    const bank = typeof tx.gateway === 'string' ? tx.gateway.trim() : '';
    return `💵 ${[`${sign}${this.formatVND(amount)}`, bank].filter(Boolean).join(' · ')}`;
  }

  /** Nội dung CK — cắt ngắn để tin Zalo không bị dài lê thê. '' nếu trống. */
  private contentLine(tx: Record<string, any>): string {
    const raw =
      typeof tx.content === 'string' && tx.content.trim() ? tx.content
      : typeof tx.description === 'string' ? tx.description : '';
    const text = raw.trim().replace(/\s+/g, ' ');
    if (!text) return '';
    return `📝 ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
  }

  /** Số dư sau giao dịch (cột accumulated SePay gửi kèm). '' nếu ngân hàng không trả. */
  private balanceLine(tx: Record<string, any>): string {
    const acc = Number(tx.accumulated);
    return Number.isFinite(acc) && acc > 0 ? `🏦 Số dư: ${this.formatVND(acc)}` : '';
  }

  private timeLine(tx: Record<string, any>): string {
    const time = this.formatTxTime(tx.transaction_date ?? tx.received_at);
    return time ? `🕒 ${time}` : '';
  }

  // ── Nội dung từng loại tin ───────────────────────────────
  /**
   * Đơn vừa nhận tiền. Trạng thái lấy từ payStatus/paid_amount của DB thay vì đoán
   * bằng prefix "C" trong nội dung CK — trả một phần trước đây vẫn hiện "THANH TOÁN".
   */
  private buildPaidMessage(
    orderNumber: string,
    amount: number,
    tx: Record<string, any>,
    res: SepayResult,
  ): string {
    const paid = Number(res.paidAmount);
    const total = Number(res.orderTotal);
    const partial = res.payStatus === 'DEPOSITED';

    const lines = [
      this.title(`💰 ${partial ? 'CỌC' : 'THANH TOÁN'} · ${orderNumber}`, tx),
      this.moneyLine(amount, tx),
    ];
    if (Number.isFinite(paid) && Number.isFinite(total) && total > 0) {
      const short = total - paid;
      lines.push(
        short > 0
          ? `📊 Đã trả ${this.formatVND(paid)}/${this.formatVND(total)} · còn thiếu ${this.formatVND(short)}`
          : `📊 Đã trả đủ ${this.formatVND(total)}`,
      );
    }
    // Khớp theo số tiền là suy đoán (nội dung CK không có mã đơn) → nói rõ để còn soát lại.
    if (res.matchBy === 'amount') lines.push('🔎 Tự khớp theo số tiền — kiểm tra lại nếu thấy lạ');
    lines.push(this.balanceLine(tx), this.timeLine(tx));
    return lines.filter(Boolean).join('\n');
  }

  /** Tiền vào nhưng ≥2 đơn cùng số tiền → không tự khớp được, phải đối soát tay. */
  private buildReviewMessage(
    amount: number,
    ambiguousCount: number,
    tx: Record<string, any>,
  ): string {
    return [
      this.title('⚠️ NHẬN TIỀN CẦN ĐỐI SOÁT', tx),
      this.moneyLine(amount, tx),
      this.contentLine(tx),
      `🔎 ${ambiguousCount} đơn cùng số tiền — không tự khớp được`,
      this.balanceLine(tx),
      this.timeLine(tx),
      '👉 Vào màn Giao dịch để đối soát thủ công',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Tiền vào không khớp đơn nào (nội dung CK không có mã đơn, số tiền cũng không trùng
   * đơn nào đang chờ). Trước đây im lặng hoàn toàn — tiền về mà không ai hay.
   */
  private buildUnmatchedInMessage(amount: number, tx: Record<string, any>): string {
    return [
      this.title('💵 NHẬN TIỀN · chưa gắn đơn', tx),
      this.moneyLine(amount, tx),
      this.contentLine(tx),
      this.balanceLine(tx),
      this.timeLine(tx),
      '👉 Vào màn Giao dịch để gắn đơn / đối soát',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Tiền ra khỏi tài khoản. App không tự biết là hoàn tiền hay kết toán về TK chính
   * (hai thứ này tính khác nhau trong doanh thu) nên chỉ báo + nhắc vào phân loại.
   */
  private buildOutgoingMessage(amount: number, tx: Record<string, any>): string {
    return [
      this.title('💸 TIỀN RA', tx),
      this.moneyLine(amount, tx, '-'),
      this.contentLine(tx),
      this.balanceLine(tx),
      this.timeLine(tx),
      '👉 Vào màn Giao dịch đánh dấu hoàn tiền / đã kết toán',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
