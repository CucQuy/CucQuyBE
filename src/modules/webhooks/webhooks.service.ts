import { Injectable } from '@nestjs/common';
import { WebhookProc } from './webhooks.proc';
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
      // Bắn Zalo nhóm (không await — không chặn response webhook). Lỗi Zalo bỏ qua.
      this.zalo
        .send({
          message: `💰 Đơn hàng ${res.orderNumber} đã thanh toán ${amount.toLocaleString(
            'vi-VN',
          )} VND`,
        })
        .catch(() => undefined);
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
}
