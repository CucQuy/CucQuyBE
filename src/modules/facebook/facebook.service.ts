import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { FacebookProc, type FacebookContact } from './facebook.proc';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Kết quả gửi 1 tin cho 1 khách. */
export interface FbSendResult {
  psid: string;
  sent: boolean;
  error?: string;
}

/**
 * Facebook Messenger cho fanpage Cúc Quy: nhận tin khách (webhook), đồng bộ danh sách
 * người đã inbox (PSID) và gửi tin text.
 *
 * ⚠️ Luật Meta (khác Zalo): CHỈ nhắn được người đã inbox page, và tự do trong 24h kể từ
 * tin CUỐI của họ. Ngoài 24h phải có opt-in (recurring notifications) — nội dung quảng bá
 * mà lách bằng message tag là bị khoá quyền nhắn tin. `sendText` vì thế chặn sẵn ở app.
 */
@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(private readonly proc: FacebookProc) {}

  private cfg() {
    return {
      pageId: String(process.env.FACEBOOK_PAGE_ID ?? '').trim(),
      token: String(process.env.FACEBOOK_PAGE_TOKEN ?? '').trim(),
      secret: String(process.env.FACEBOOK_APP_SECRET ?? '').trim(),
      verifyToken: String(process.env.FACEBOOK_VERIFY_TOKEN ?? '').trim(),
    };
  }

  /** Bật/tắt tính năng theo env (chưa cấu hình → coi như tắt, không lỗi ồn ào). */
  isConfigured(): boolean {
    const c = this.cfg();
    return Boolean(c.pageId && c.token);
  }

  // ── Webhook ────────────────────────────────────────────────
  /** Meta gọi GET để xác minh URL khi khai webhook. Trả challenge nếu verify token khớp. */
  verifyWebhook(mode: string, token: string, challenge: string): string {
    const { verifyToken } = this.cfg();
    if (mode === 'subscribe' && verifyToken && token === verifyToken) return challenge;
    throw new BadRequestException('FB_VERIFY_FAILED');
  }

  /**
   * Kiểm chữ ký X-Hub-Signature-256 (HMAC-SHA256 body với App Secret) — không có bước này
   * thì ai cũng POST giả vào endpoint public được. Thiếu App Secret → bỏ qua (log cảnh báo).
   */
  verifySignature(rawBody: Buffer | string | undefined, header: string | undefined): boolean {
    const { secret } = this.cfg();
    if (!secret) {
      this.logger.warn('FACEBOOK_APP_SECRET trống — bỏ qua kiểm chữ ký webhook');
      return true;
    }
    if (!rawBody || !header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
      .digest('hex');
    const got = header.slice('sha256='.length);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(got, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Xử lý payload webhook: lưu tin khách nhắn + cập nhật mốc 24h. */
  async handleWebhook(body: Record<string, any>): Promise<void> {
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
      for (const ev of events) {
        const psid = String(ev?.sender?.id ?? '').trim();
        if (!psid || psid === this.cfg().pageId) continue;

        // Khách bấm nút "Đăng ký nhận tin" (recurring notifications) → cho phép gửi ngoài 24h.
        if (ev?.messaging_optins) {
          await this.proc.upsertContact({ psid });
          this.logger.log(`FB opt-in từ ${psid}`);
          continue;
        }
        if (!ev?.message) continue;

        const text = String(ev.message?.text ?? '');
        const attachments = Array.isArray(ev.message?.attachments) ? ev.message.attachments : null;
        await this.proc.addMessage({
          id: ev.message?.mid,
          psid,
          direction: 'in',
          text,
          attachments,
          createdAt: ev?.timestamp ? new Date(Number(ev.timestamp)).toISOString() : undefined,
        });
        // Tên/ảnh khách: lấy nền, lỗi thì thôi (không chặn webhook — Meta cần 200 nhanh).
        void this.fetchProfile(psid).catch(() => undefined);
      }
    }
  }

  /**
   * Tên khách để hiện trong app.
   * GET /{psid}?fields=name cần quyền `pages_user_profile` (chưa xin) → dùng đường
   * /{page}/conversations?user_id={psid}, participants đã kèm tên và chỉ cần
   * `pages_messaging`. Lỗi thì bỏ qua, tên rỗng không chặn gì.
   */
  private async fetchProfile(psid: string): Promise<void> {
    const { pageId, token } = this.cfg();
    if (!pageId || !token) return;
    const res = await fetch(
      `${GRAPH}/${pageId}/conversations?user_id=${encodeURIComponent(psid)}` +
        `&fields=participants,updated_time,message_count&access_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return;
    const body = (await res.json()) as { data?: any[] };
    const conv = body?.data?.[0];
    const other = (conv?.participants?.data ?? []).find((p: any) => String(p?.id) !== pageId);
    if (!other?.name) return;
    await this.proc.upsertContact({
      psid,
      name: String(other.name),
      messageCount: Number(conv?.message_count) || 0,
    });
  }

  // ── Đồng bộ danh sách khách đã inbox ───────────────────────
  /**
   * Kéo danh sách hội thoại của page → lưu PSID + tên + mốc nhắn cuối.
   * Đây là cách lấy "danh sách user" mà không cần chờ khách nhắn mới.
   */
  async syncConversations(limit = 200): Promise<{ synced: number }> {
    const { pageId, token } = this.cfg();
    if (!pageId || !token) throw new BadRequestException('FACEBOOK_NOT_CONFIGURED');

    let url =
      `${GRAPH}/${pageId}/conversations?fields=participants,updated_time,message_count` +
      `&limit=100&access_token=${encodeURIComponent(token)}`;
    let synced = 0;

    while (url && synced < limit) {
      const res = await fetch(url);
      const body = (await res.json()) as {
        data?: any[];
        paging?: { next?: string };
        error?: { message?: string };
      };
      if (body?.error) throw new BadRequestException(body.error.message ?? 'FB_API_ERROR');

      for (const conv of body?.data ?? []) {
        const parts = conv?.participants?.data ?? [];
        const other = parts.find((p: any) => String(p?.id) !== pageId);
        if (!other?.id) continue;
        await this.proc.upsertContact({
          psid: String(other.id),
          name: String(other.name ?? ''),
          lastInboundAt: conv?.updated_time ?? null,
          messageCount: Number(conv?.message_count) || 0,
        });
        synced += 1;
      }
      url = body?.paging?.next ?? '';
    }
    this.logger.log(`Đồng bộ Facebook: ${synced} hội thoại`);
    return { synced };
  }

  // ── Danh sách + gửi tin ────────────────────────────────────
  async listContacts(filter: string, limit: number, offset: number) {
    const f = ['window', 'optin'].includes(filter) ? filter : '';
    return this.proc.listContacts(f, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0));
  }

  /** Gọi Send API 1 lần với `message` dựng sẵn (text / ảnh / thẻ). */
  private async callSend(
    psid: string,
    message: Record<string, unknown>,
    logText: string,
  ): Promise<FbSendResult> {
    const { token } = this.cfg();
    try {
      const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message }),
      });
      const body = (await res.json()) as { error?: { message?: string }; message_id?: string };
      if (body?.error) {
        const err = body.error.message ?? 'FB_SEND_ERROR';
        await this.proc.addMessage({ psid, direction: 'out', text: logText, error: err });
        return { psid, sent: false, error: err };
      }
      await this.proc.addMessage({ id: body?.message_id, psid, direction: 'out', text: logText });
      return { psid, sent: true };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await this.proc.addMessage({ psid, direction: 'out', text: logText, error: err });
      return { psid, sent: false, error: err };
    }
  }

  /**
   * Gửi cho 1 khách: text và/hoặc ảnh. Messenger KHÔNG có caption cho ảnh nên text đi
   * trước rồi tới ảnh (2 tin). Có `button` → gửi dạng THẺ (ảnh + tiêu đề + nút bấm).
   * CHẶN nếu khách ngoài 24h và chưa opt-in — gửi bừa là Meta khoá quyền nhắn tin.
   */
  private async sendOne(
    contact: FacebookContact,
    payload: { text?: string; imageUrl?: string; buttonTitle?: string; buttonUrl?: string },
  ): Promise<FbSendResult> {
    const canSend = contact.inWindow || Boolean(contact.optedInAt);
    if (!canSend) {
      return { psid: contact.psid, sent: false, error: 'Ngoài 24h và khách chưa đăng ký nhận tin' };
    }
    const text = (payload.text ?? '').trim();
    const img = (payload.imageUrl ?? '').trim();
    const btnTitle = (payload.buttonTitle ?? '').trim();
    const btnUrl = (payload.buttonUrl ?? '').trim();

    // Ảnh + nút → 1 THẺ duy nhất (đẹp hơn, bấm được).
    if (img && btnTitle && btnUrl) {
      return this.callSend(
        contact.psid,
        {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [
                {
                  title: text.split('\n')[0].slice(0, 80) || 'Tiệm Bánh Cúc Quy',
                  subtitle: text.split('\n').slice(1).join(' ').slice(0, 80) || undefined,
                  image_url: img,
                  buttons: [{ type: 'web_url', url: btnUrl, title: btnTitle.slice(0, 20) }],
                },
              ],
            },
          },
        },
        `[thẻ] ${text}`.trim(),
      );
    }

    // Text trước (nếu có), rồi ảnh rời (nếu có).
    let last: FbSendResult = { psid: contact.psid, sent: false, error: 'Không có nội dung' };
    if (text) last = await this.callSend(contact.psid, { text }, text);
    if (img) {
      if (text) await new Promise((r) => setTimeout(r, 400));
      const r = await this.callSend(
        contact.psid,
        { attachment: { type: 'image', payload: { url: img, is_reusable: true } } },
        `[ảnh] ${img}`,
      );
      // Text OK mà ảnh lỗi → báo lỗi để người gửi biết ảnh chưa tới.
      last = r.sent && last.sent !== false ? r : r.sent ? last : r;
    }
    return last;
  }

  /**
   * Gửi cho nhiều khách (rải 1s/tin). `text` và/hoặc `imageUrl`; kèm nút thì thành thẻ.
   * Trả kết quả từng người để màn hình hiện ai nhận được, ai không và vì sao.
   */
  async sendMessage(
    psids: string[],
    payload: { text?: string; imageUrl?: string; buttonTitle?: string; buttonUrl?: string },
  ): Promise<{ results: FbSendResult[] }> {
    if (!this.isConfigured()) throw new BadRequestException('FACEBOOK_NOT_CONFIGURED');
    const text = String(payload?.text ?? '').trim();
    const imageUrl = String(payload?.imageUrl ?? '').trim();
    if (!text && !imageUrl) throw new BadRequestException('Chưa có nội dung (text hoặc ảnh)');
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      throw new BadRequestException('Ảnh phải là URL https công khai');
    }

    const { items } = await this.proc.listContacts('', 500, 0);
    const byPsid = new Map(items.map((c) => [c.psid, c]));
    const results: FbSendResult[] = [];

    for (const psid of psids) {
      const c = byPsid.get(psid);
      if (!c) {
        results.push({ psid, sent: false, error: 'Không có trong danh sách khách Facebook' });
        continue;
      }
      results.push(await this.sendOne(c, { ...payload, text, imageUrl }));
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { results };
  }
}
