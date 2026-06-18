import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NOTIFICATIONS } from '../../queue/queue.constants';

const ZALO_ENDPOINT = {
  sendImageToGroup: '/zalo/sendImageToGroupZalo/2',
  sendMessToGroup: '/zalo/sendMessageToGroupZalo/2',
};
const ZALO_SENDER_NUMBER = '84776750418';

/**
 * Payload body của POST /zalo/send. Bao đủ mọi biến thể mà lớp gửi HTTP của FE
 * (sendZaloMessage / postTextToGroups / postImageToGroups) cần:
 * - message: nội dung text (bắt buộc cho mọi loại).
 * - groupIds: danh sách group đích. Nếu rỗng → dùng ZALO_MAIN_GROUP_ID từ env.
 * - image: tham số gửi kèm ảnh (caption + image_url) → dùng endpoint sendImage.
 */
export interface ZaloSendPayload {
  message: string;
  groupIds?: string[];
  image?: {
    caption: string;
    image_url: string[];
  };
}

@Injectable()
export class ZaloService {
  private readonly logger = new Logger(ZaloService.name);

  constructor(
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
  ) {}

  /**
   * Đẩy job gửi Zalo vào queue → trả ngay (worker gửi + retry). Nếu queue/Redis
   * lỗi thì gửi thẳng (deliver) để không mất thông báo.
   */
  async send(payload: ZaloSendPayload): Promise<{ ok: true; queued?: boolean }> {
    try {
      await this.queue.add('zalo', payload);
      return { ok: true, queued: true };
    } catch (err) {
      this.logger.warn(`Enqueue Zalo thất bại, gửi trực tiếp: ${String(err)}`);
      await this.deliver(payload);
      return { ok: true };
    }
  }

  /** Gửi thật tới Zalo. Lỗi → throw để BullMQ retry. */
  async deliver(payload: ZaloSendPayload): Promise<void> {
    // Gắn nhãn môi trường vào noti để biết bắn từ đâu. production → để sạch (không tag);
    // staging/local → prefix [STAGING]/[LOCAL] tránh nhầm tin test với đơn thật.
    const envLabel = String(process.env.APP_ENV ?? '').trim();
    const envTag =
      envLabel && envLabel.toLowerCase() !== 'production'
        ? `[${envLabel.toUpperCase()}] `
        : '';
    const message = envTag + (payload?.message ?? '');
    const baseUrl = String(process.env.ZALO_URL ?? '').trim();
    const shopCode = String(process.env.ZALO_SHOP_CODE ?? '').trim();
    const token = String(process.env.ZALO_TOKEN ?? '').trim();
    const mainGroupId = String(process.env.ZALO_MAIN_GROUP_ID ?? '').trim();

    if (!baseUrl || !shopCode || !token) {
      throw new BadRequestException('Zalo configuration is missing');
    }

    // Nếu FE không truyền groupIds (tương đương sendZaloMessage cũ) → group chính từ env.
    const groupIds =
      Array.isArray(payload?.groupIds) && payload.groupIds.length > 0
        ? payload.groupIds
        : [mainGroupId];

    const useImage =
      payload?.image &&
      Array.isArray(payload.image.image_url) &&
      payload.image.image_url.length > 0;

    const endpoint = useImage
      ? ZALO_ENDPOINT.sendImageToGroup
      : ZALO_ENDPOINT.sendMessToGroup;
    const url = `${baseUrl}${endpoint}/${shopCode}/${token}`;

    await Promise.all(
      groupIds.map(async (groupId) => {
        const body: Record<string, unknown> = {
          send_from_number: ZALO_SENDER_NUMBER,
          send_to_groupid: groupId,
          message,
        };
        if (useImage && payload.image) {
          body.caption = envTag + (payload.image.caption ?? '');
          body.image_url = payload.image.image_url;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          let detail = '';
          try {
            detail = await res.text();
          } catch {
            // ignore
          }
          throw new Error(`Zalo send failed (${res.status}): ${detail}`);
        }
      }),
    );
  }
}
