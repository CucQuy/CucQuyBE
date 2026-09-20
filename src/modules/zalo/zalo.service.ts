import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NOTIFICATIONS } from '../../queue/queue.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { ZaloProc } from './zalo.proc';

const ZALO_ENDPOINT = {
  sendImageToGroup: '/zalo/sendImageToGroupZalo/2',
  sendMessToGroup: '/zalo/sendMessageToGroupZalo/2',
  sendMessToNumber: '/zalo/sendMessageZalo/2', // gửi tin nhắn Zalo CÁ NHÂN theo SĐT
  sendFileToNumber: '/zalo/sendFileZalo/2', // file tài liệu (xlsx/pdf/doc) cho CÁ NHÂN
  sendFileToGroup: '/zalo/sendFileToGroupZalo/2', // file tài liệu vào nhóm
  listGroups: '/zalo/listAllGroupForPartner/2', // danh sách nhóm của 1 nick đã kết nối
};
/**
 * Tính năng thông báo — mỗi nhóm Zalo tự khai nhận loại nào (Cài đặt Zalo → Nhóm).
 * Caller gửi `feature` thay vì tự biết ID nhóm; BE tra `zalo_group_ids_for_feature`.
 */
export const ZALO_NOTIFY_FEATURES = [
  'order_create',
  'order_update',
  'order_delete',
  'payment',
  'unpaid',
  'pending',
  'delivery_due',
  'production_tomorrow',
  'stuck_pending',
  'daily_summary',
  'custom',
  'health_check',
] as const;
export type ZaloNotifyFeature = (typeof ZALO_NOTIFY_FEATURES)[number];

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
 * - groupIds: danh sách group đích. Rỗng → tra theo `feature` (Cài đặt Zalo → Nhóm).
 * - image: tham số gửi kèm ảnh (caption + image_url) → dùng endpoint sendImage.
 * - files: tham số gửi kèm file tài liệu (xlsx/pdf/doc) → dùng endpoint sendFile*.
 */
export interface ZaloSendPayload {
  message: string;
  /** Nhãn nhóm nghiệp vụ cho nhật ký (mặc định 'zalo_send'); vd 'customer_order'. */
  category?: string;
  /** Đơn liên quan — lưu vào payload nhật ký để màn "Thông báo" join ra đơn. */
  orderId?: string;
  /** Kênh gửi ('zalo' mặc định) — cột trong ma trận thông báo. */
  channel?: string;
  groupIds?: string[];
  /**
   * Tính năng thông báo → BE tự tra nhóm đích. Dùng khi caller KHÔNG tự biết nhóm
   * (trước đây rơi vào "nhóm chính"). Bỏ qua nếu đã truyền groupIds.
   */
  feature?: ZaloNotifyFeature;
  /** Gửi tin nhắn CÁ NHÂN tới các SĐT (đã chuẩn hoá 84...). Ưu tiên hơn groupIds nếu có. */
  toNumbers?: string[];
  image?: {
    caption: string;
    image_url: string[];
  };
  /**
   * File tài liệu gửi kèm (Excel/PDF/Word). Abit KHÔNG nhận upload — nó tự tải
   * `url` về rồi gửi, nên url phải công khai trên internet (vd link tải bảng lương
   * có token) và PHẢI có đuôi file trong đường dẫn: Abit ghép tên hiển thị =
   * `name` + đuôi lấy từ url, url không đuôi → Zalo báo "Có lỗi trong quá trình
   * tải File". Vì vậy `name` để TRẦN, không kèm '.xlsx'.
   */
  files?: { url: string; name: string }[];
}

@Injectable()
export class ZaloService {
  private readonly logger = new Logger(ZaloService.name);

  constructor(
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
    private readonly notif: NotificationsService,
    private readonly proc: ZaloProc,
  ) {}

  /**
   * Đẩy job gửi Zalo vào queue → trả ngay (worker gửi + retry). Nếu queue/Redis
   * lỗi thì gửi thẳng (deliver) để không mất thông báo.
   */
  async send(
    payload: ZaloSendPayload,
    opts: { delayMs?: number } = {},
  ): Promise<{ ok: true; queued?: boolean; skipped?: 'feature_off' }> {
    // Chức năng bị TẮT ở màn "Chức năng" (096) → không enqueue, không ghi nhật ký
    // failed (tắt là chủ ý, không phải lỗi). Trả skipped để caller báo lại cho user.
    if (payload?.feature && !(await this.proc.featureEnabled(payload.feature))) {
      this.logger.log(`Bỏ qua Zalo: chức năng "${payload.feature}" đang tắt`);
      return { ok: true, skipped: 'feature_off' };
    }
    try {
      // delayMs: rải tin (gửi cho KHÁCH) để không bắn dồn → bridge Abit chặn IP.
      await this.queue.add('zalo', payload, opts.delayMs ? { delay: opts.delayMs } : undefined);
      return { ok: true, queued: true };
    } catch (err) {
      this.logger.warn(`Enqueue Zalo thất bại, gửi trực tiếp: ${String(err)}`);
      await this.deliver(payload);
      return { ok: true };
    }
  }

  /**
   * Danh sách nhóm Zalo của 1 nick đã kết nối trên Abit
   * (POST /zalo/listAllGroupForPartner — theo apidocs.abit.vn). Dùng để chọn đúng ID
   * nhóm ở Cài đặt Zalo thay vì copy tay. Số mặc định = số gửi đang cấu hình.
   */
  async listGroups(
    phone?: string,
  ): Promise<{ groupId: string; name: string; members: number; avatar: string }[]> {
    const baseUrl = String(process.env.ZALO_URL ?? '').trim();
    const shopCode = String(process.env.ZALO_SHOP_CODE ?? '').trim();
    const token = String(process.env.ZALO_TOKEN ?? '').trim();
    if (!baseUrl || !shopCode || !token) {
      throw new BadRequestException('Zalo configuration is missing');
    }
    const num = toZaloNumber(phone ?? '') ?? ZALO_SENDER_NUMBER;
    const res = await fetch(`${baseUrl}${ZALO_ENDPOINT.listGroups}/${shopCode}/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: num }),
    });
    const raw = await res.text().catch(() => '');
    if (!res.ok) throw new BadRequestException(`Không lấy được danh sách nhóm (${res.status})`);
    let body: { all_groups?: unknown; status?: unknown; message?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      throw new BadRequestException('Bridge Zalo trả dữ liệu không hợp lệ');
    }
    if (String(body.status ?? '').toLowerCase() === 'error') {
      throw new BadRequestException(String(body.message ?? 'Bridge Zalo trả lỗi'));
    }
    const arr = Array.isArray(body.all_groups) ? body.all_groups : [];
    return arr.map((g) => {
      const r = (g ?? {}) as Record<string, unknown>;
      return {
        groupId: String(r.groupId ?? ''),
        name: String(r.groupname ?? ''),
        members: typeof r.number_member === 'number' ? r.number_member : 0,
        // Ảnh đại diện nhóm (group_avt) — hiện ở bảng nhóm cho dễ nhận ra.
        avatar: String(r.group_avt ?? ''),
      };
    }).filter((g) => g.groupId);
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
          category: payload?.category || 'zalo_send',
          title: this.summarize(payload?.message ?? ''),
          body: payload?.message ?? '',
          target:
            (payload?.toNumbers ?? []).join(', ') ||
            (payload?.groupIds ?? []).join(', ') ||
            (payload?.feature ? `feature:${payload.feature}` : '-'),
          status: 'sent',
          payload,
          triggeredBy: opts.triggeredBy,
        });
      }
    } catch (err) {
      if (shouldLog) {
        await this.notif.log({
          kind: 'zalo',
          category: payload?.category || 'zalo_send',
          title: this.summarize(payload?.message ?? ''),
          body: payload?.message ?? '',
          target:
            (payload?.toNumbers ?? []).join(', ') ||
            (payload?.groupIds ?? []).join(', ') ||
            (payload?.feature ? `feature:${payload.feature}` : '-'),
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
    if (!baseUrl || !shopCode || !token) {
      throw new BadRequestException('Zalo configuration is missing');
    }

    // File tài liệu (xlsx/pdf/doc): Abit tự tải url về rồi gửi kèm tin nhắn.
    // Có file → chuyển sang endpoint sendFile* (cá nhân/nhóm), bỏ qua nhánh ảnh.
    const fileUrl =
      Array.isArray(payload?.files) && payload.files.length > 0
        ? payload.files
            .filter((f) => f?.url)
            .map((f) => ({ file_url_item: f.url, file_name_item: f.name || 'file' }))
        : null;

    // Gửi CÁ NHÂN theo SĐT (nhắc đăng ký ca…) — ưu tiên khi có toNumbers.
    const toNumbers = Array.isArray(payload?.toNumbers)
      ? payload.toNumbers.map((n) => toZaloNumber(n)).filter((n): n is string => !!n)
      : [];
    if (toNumbers.length > 0) {
      const endpoint = fileUrl
        ? ZALO_ENDPOINT.sendFileToNumber
        : ZALO_ENDPOINT.sendMessToNumber;
      const url = `${baseUrl}${endpoint}/${shopCode}/${token}`;
      await Promise.all(
        toNumbers.map(async (num) => {
          const body: Record<string, unknown> = {
            send_from_number: ZALO_SENDER_NUMBER,
            send_to_number: num,
            message,
            action: 'make_friend', // kèm yêu cầu kết bạn để NV chưa kết bạn vẫn nhận được
          };
          if (fileUrl) body.file_url = fileUrl;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          await assertBridgeOk(res, `Zalo personal send (${num})`);
        }),
      );
      return;
    }

    // Gửi trực tiếp (worker/gửi lại) cũng phải tôn trọng cờ bật/tắt — throw để lần
    // "gửi lại" 1 noti của chức năng đã tắt báo rõ thay vì gửi lén.
    if (payload?.feature && !(await this.proc.featureEnabled(payload.feature))) {
      throw new BadRequestException(
        `Chức năng thông báo "${payload.feature}" đang tắt (Cài đặt Zalo → Chức năng)`,
      );
    }

    // Không truyền groupIds → tra nhóm theo tính năng (095). Không nhóm nào được gán
    // thì THROW để nhật ký ghi 'failed' kèm lý do, thay vì gửi lặng vào nhóm chính cũ.
    const explicit = Array.isArray(payload?.groupIds)
      ? payload.groupIds.map((g) => String(g ?? '').trim()).filter(Boolean)
      : [];
    let groupIds = explicit;
    if (groupIds.length === 0) {
      if (!payload?.feature) {
        throw new BadRequestException(
          'Thiếu nhóm đích: truyền groupIds hoặc feature khi gửi Zalo',
        );
      }
      groupIds = await this.proc.groupIdsForFeature(payload.feature);
      if (groupIds.length === 0) {
        throw new BadRequestException(
          `Chưa có nhóm Zalo nào được gán thông báo "${payload.feature}" (Cài đặt Zalo → Nhóm)`,
        );
      }
    }

    const useImage =
      payload?.image &&
      Array.isArray(payload.image.image_url) &&
      payload.image.image_url.length > 0;

    const endpoint = fileUrl
      ? ZALO_ENDPOINT.sendFileToGroup
      : useImage
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
        if (fileUrl) body.file_url = fileUrl;
        else if (useImage && payload.image) {
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
