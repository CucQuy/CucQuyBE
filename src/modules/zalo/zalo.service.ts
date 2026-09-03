import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NOTIFICATIONS } from '../../queue/queue.constants';
import { NotificationsService } from '../notifications/notifications.service';

const ZALO_ENDPOINT = {
  sendImageToGroup: '/zalo/sendImageToGroupZalo/2',
  sendMessToGroup: '/zalo/sendMessageToGroupZalo/2',
  sendMessToNumber: '/zalo/sendMessageZalo/2', // gửi tin nhắn Zalo CÁ NHÂN theo SĐT
};
// SĐT tài khoản Zalo dùng để GỬI (bridge phải đang đăng nhập số này).
// Đổi số → set env ZALO_SENDER_NUMBER là đủ, không cần build lại image.
const ZALO_SENDER_NUMBER = process.env.ZALO_SENDER_NUMBER || '84349049567';

/**
 * Bridge Abit LUÔN trả HTTP 200, kết quả thật nằm trong body: `{status:'success'|'error', message}`.
 * Trước đây chỉ check res.ok → noti bị ghi 'sent' dù Zalo KHÔNG gửi (vd hết quota
 * "đã sử dụng tối đa cấu hình số lần tìm kiếm/giờ", số gửi chưa kết nối, không thấy nhóm).
 * Hàm này đọc body và throw kèm message của Abit để noti thành 'failed' + hiện lý do.
 */
async function assertBridgeOk(res: Response, what: string): Promise<void> {
  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${raw.slice(0, 300)}`);
  if (!raw.trim()) throw new Error(`${what} failed: bridge Zalo không phản hồi nội dung`);
  type BridgeBody = { status?: unknown; code?: unknown; message?: unknown };
  let body: BridgeBody;
  try {
    body = JSON.parse(raw) as BridgeBody;
  } catch {
    return; // body không phải JSON → coi như OK (giữ hành vi cũ, đừng chặn oan)
  }
  const status = String(body.status ?? '').toLowerCase();
  if (status && status !== 'success') {
    const msg = String(body.message ?? raw.slice(0, 200));
    throw new Error(`${what} failed [${String(body.code ?? '')}]: ${msg}`);
  }
}

/** Chuẩn hoá SĐT VN về dạng Zalo yêu cầu: 84xxxxxxxxx (bỏ khoảng trắng, +, 0 đầu). */
export function toZaloNumber(raw: string): string | null {
  const d = String(raw ?? '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('84')) return d;
  if (d.startsWith('0')) return `84${d.slice(1)}`;
  return `84${d}`;
}

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
  /** Gửi tin nhắn CÁ NHÂN tới các SĐT (đã chuẩn hoá 84...). Ưu tiên hơn groupIds nếu có. */
  toNumbers?: string[];
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
    private readonly notif: NotificationsService,
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

  /** Nhãn ngắn cho nhật ký (dòng đầu message). */
  private summarize(msg: string): string {
    const first = (msg ?? '').split('\n').find((l) => l.trim()) ?? '';
    return first.slice(0, 120);
  }

  /**
   * Gửi thật tới Zalo. Lỗi → throw để BullMQ retry.
   * Mặc định ghi nhật ký (sent/failed) kèm payload để gửi lại; opts.log=false khi
   * đang gửi lại (tránh nhân đôi dòng log).
   */
  async deliver(
    payload: ZaloSendPayload,
    opts: { log?: boolean; triggeredBy?: string } = {},
  ): Promise<void> {
    const shouldLog = opts.log !== false;
    try {
      await this.deliverRaw(payload);
      if (shouldLog) {
        await this.notif.log({
          kind: 'zalo',
          category: 'zalo_send',
          title: this.summarize(payload?.message ?? ''),
          body: payload?.message ?? '',
          target:
            (payload?.toNumbers ?? []).join(', ') ||
            (payload?.groupIds ?? []).join(', ') ||
            'nhóm chính',
          status: 'sent',
          payload,
          triggeredBy: opts.triggeredBy,
        });
      }
    } catch (err) {
      if (shouldLog) {
        await this.notif.log({
          kind: 'zalo',
          category: 'zalo_send',
          title: this.summarize(payload?.message ?? ''),
          body: payload?.message ?? '',
          target:
            (payload?.toNumbers ?? []).join(', ') ||
            (payload?.groupIds ?? []).join(', ') ||
            'nhóm chính',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          payload,
          triggeredBy: opts.triggeredBy,
        });
      }
      throw err;
    }
  }

  /** Gửi lại 1 thông báo Zalo failed theo payload đã lưu; cập nhật trạng thái dòng gốc. */
  async resend(id: string): Promise<void> {
    const payload = (await this.notif.getPayload(id)) as ZaloSendPayload | null;
    if (!payload || !payload.message) {
      throw new BadRequestException('Không tìm thấy nội dung để gửi lại');
    }
    try {
      await this.deliver(payload, { log: false });
      await this.notif.setStatus(id, 'sent', null);
    } catch (err) {
      await this.notif.setStatus(id, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /** Gửi thật (không log) — tách để deliver bọc nhật ký. */
  private async deliverRaw(payload: ZaloSendPayload): Promise<void> {
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

    // Gửi CÁ NHÂN theo SĐT (nhắc đăng ký ca…) — ưu tiên khi có toNumbers.
    const toNumbers = Array.isArray(payload?.toNumbers)
      ? payload.toNumbers.map((n) => toZaloNumber(n)).filter((n): n is string => !!n)
      : [];
    if (toNumbers.length > 0) {
      const url = `${baseUrl}${ZALO_ENDPOINT.sendMessToNumber}/${shopCode}/${token}`;
      await Promise.all(
        toNumbers.map(async (num) => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              send_from_number: ZALO_SENDER_NUMBER,
              send_to_number: num,
              message,
              action: 'make_friend', // kèm yêu cầu kết bạn để NV chưa kết bạn vẫn nhận được
            }),
          });
          await assertBridgeOk(res, `Zalo personal send (${num})`);
        }),
      );
      return;
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
        await assertBridgeOk(res, `Zalo group send (${groupId})`);
      }),
    );
  }
}
