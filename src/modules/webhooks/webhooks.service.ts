import { Injectable } from '@nestjs/common';
import { WebhookProc } from './webhooks.proc';

/** Service chỉ orchestration + dựng payload HTTP; mọi DB qua WebhookProc. */
@Injectable()
export class WebhooksService {
  constructor(private readonly proc: WebhookProc) {}

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
