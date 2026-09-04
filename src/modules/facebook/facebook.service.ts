import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { FacebookProc, type FacebookContact } from './facebook.proc';
import { FacebookCommentsService } from './facebook-comments.service';

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
  /** Mốc lần quét hồ sơ (tên/ảnh) gần nhất — chặn quét dồn khi FE gọi liên tục. */
  private lastProfileSweep = 0;
  /** id tài khoản Instagram gắn với page — dùng để loại tin do chính mình gửi. */
  private igUserId = '';

  constructor(
    private readonly proc: FacebookProc,
    private readonly comments: FacebookCommentsService,
  ) {}

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

  /**
   * Xử lý payload webhook: tin nhắn (`entry[].messaging[]`) và BÌNH LUẬN
   * (`entry[].changes[]` với field='feed'). Bình luận mới → lưu + chạy luật tự động.
   */
  async handleWebhook(body: Record<string, any>): Promise<void> {
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      // ── Bình luận / bài đăng (fanpage `feed`, Instagram `comments`) ──
      const igEntry = String(body?.object ?? '') === 'instagram';
      for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
        if (ch?.field !== 'feed' && ch?.field !== 'comments') continue;
        const v = ch?.value ?? {};
        // Instagram không có `item`; sự kiện field='comments' luôn là bình luận.
        if (!igEntry && v?.item !== 'comment') continue;
        const psid = String(v?.from?.id ?? '');
        if (psid && psid === this.cfg().pageId) continue; // bình luận của chính page

        // IG đặt id ở `id`, Facebook ở `comment_id`.
        const commentId = String(v?.comment_id ?? v?.id ?? '');
        if (!commentId) continue;
        if (v?.verb === 'remove') {
          await this.proc.deleteComment(commentId).catch(() => undefined);
          continue;
        }
        // IG dùng `text` cho nội dung và `username` cho tên người bình luận.
        const message = String(v?.message ?? v?.text ?? '');
        await this.proc.upsertComment({
          id: commentId,
          postId: String(v?.post_id ?? v?.media?.id ?? ''),
          parentId: String(v?.parent_id ?? ''),
          psid,
          fromName: String(v?.from?.name ?? v?.from?.username ?? ''),
          message,
          createdTime: v?.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : undefined,
          platform: igEntry ? 'instagram' : 'facebook',
          raw: v,
        });
        // Luật tự động (ẩn SĐT / từ khoá, trả lời, nhắn riêng) — chạy nền, không chặn webhook.
        // IG không gửi `verb`, coi như bình luận mới.
        if (v?.verb === 'add' || igEntry) {
          void this.comments.runAutoRules({ id: commentId, message, psid }).catch(() => undefined);
        }
      }

      // Instagram Direct cũng tới qua `messaging[]`, chỉ khác `object` của webhook.
      const platform = igEntry ? 'instagram' : 'facebook';
      if (igEntry && !this.igUserId) await this.loadIgUserId();
      const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
      for (const ev of events) {
        const psid = String(ev?.sender?.id ?? '').trim();
        // Bỏ tin do CHÍNH page/IG gửi (echo) — nếu không sẽ tạo "khách" là chính mình.
        if (!psid || psid === this.cfg().pageId || psid === this.igUserId) continue;

        // Khách bấm nút "Đăng ký nhận tin" (recurring notifications) → cho phép gửi ngoài 24h.
        if (ev?.messaging_optins) {
          await this.proc.upsertContact({ psid, platform });
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
          platform,
          createdAt: ev?.timestamp ? new Date(Number(ev.timestamp)).toISOString() : undefined,
        });
        await this.proc.upsertContact({
          psid,
          platform,
          lastInboundAt: ev?.timestamp ? new Date(Number(ev.timestamp)).toISOString() : undefined,
        });
        // Tên/ảnh khách: lấy nền, lỗi thì thôi (không chặn webhook — Meta cần 200 nhanh).
        // Hồ sơ người nhắn Instagram phải hỏi qua hộp thư IG, không phải endpoint của Facebook.
        if (platform === 'instagram') void this.fetchIgProfile(psid).catch(() => undefined);
        else void this.fetchProfile(psid).catch(() => undefined);
      }
    }
  }

  /**
   * Tên + ẢNH khách để hiện trong hộp thư.
   * `GET /{psid}?fields=name,profile_pic` cần token có quyền hồ sơ page — đã có từ
   * 04/09/2026. Ảnh trả về là URL platform-lookaside có `ext=` (hạn vài tuần) nên
   * refresh mỗi lần đồng bộ; hết hạn thì FE tự rơi về avatar chữ cái đầu.
   * Thiếu quyền / lỗi → rơi về đường cũ (participants trong conversations, chỉ có tên).
   */
  private async fetchProfile(psid: string): Promise<void> {
    const { pageId, token } = this.cfg();
    if (!pageId || !token) return;
    try {
      const res = await fetch(
        `${GRAPH}/${psid}?fields=name,profile_pic&access_token=${encodeURIComponent(token)}`,
      );
      const body = (await res.json()) as {
        name?: string;
        profile_pic?: string;
        error?: unknown;
      };
      if (!body?.error && (body?.name || body?.profile_pic)) {
        await this.proc.upsertContact({
          psid,
          name: String(body.name ?? ''),
          profilePic: String(body.profile_pic ?? ''),
        });
        return;
      }
    } catch {
      // rơi xuống đường dự phòng
    }

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

  /** id tài khoản Instagram của page — hỏi Graph 1 lần rồi nhớ. */
  private async loadIgUserId(): Promise<void> {
    const { pageId, token } = this.cfg();
    if (!pageId || !token) return;
    try {
      const res = await fetch(
        `${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(token)}`,
      );
      const body = (await res.json()) as { instagram_business_account?: { id?: string } };
      this.igUserId = String(body?.instagram_business_account?.id ?? '');
    } catch {
      // không lấy được thì thôi, chỉ mất bộ lọc tin echo
    }
  }

  /**
   * Tên + ảnh người nhắn INSTAGRAM. Endpoint /{igsid} của Facebook không dùng được,
   * phải đi qua hộp thư IG của page (participants có username + profile_pic).
   */
  private async fetchIgProfile(psid: string): Promise<void> {
    const { pageId, token } = this.cfg();
    if (!pageId || !token) return;
    const res = await fetch(
      `${GRAPH}/${pageId}/conversations?platform=instagram&user_id=${encodeURIComponent(psid)}` +
        `&fields=participants,updated_time,message_count&access_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return;
    const body = (await res.json()) as { data?: any[] };
    const conv = body?.data?.[0];
    const other = (conv?.participants?.data ?? []).find((p: any) => String(p?.id) !== pageId);
    if (!other) return;
    await this.proc.upsertContact({
      psid,
      name: String(other.username ?? other.name ?? ''),
      profilePic: String(other.profile_pic ?? ''),
      platform: 'instagram',
      messageCount: Number(conv?.message_count) || 0,
    });
  }

  /** Kéo tên + ảnh cho những người chưa có ảnh (chạy sau mỗi lần đồng bộ hộp thư). */
  async refreshProfiles(limit = 40): Promise<{ updated: number }> {
    const { items } = await this.proc.listContacts('', 500, 0);
    const need = items.filter((c) => !c.profilePic).slice(0, limit);
    let updated = 0;
    for (const c of need) {
      try {
        await this.fetchProfile(c.psid);
        updated += 1;
      } catch {
        // 1 người lỗi không chặn cả loạt
      }
    }
    if (updated) this.logger.log(`Đã lấy hồ sơ ${updated} khách Facebook`);
    return { updated };
  }

  /**
   * Kéo lịch sử hội thoại với 1 người từ Graph về DB, rồi trả cả cuộc trò chuyện.
   * Webhook chỉ đẩy tin MỚI nên người nhắn trước khi nối app sẽ không có tin nào trong DB;
   * hàm này lấp phần lịch sử đó khi mở cửa sổ chat.
   *
   * `platform='instagram'` thì hỏi hộp thư Instagram (cùng endpoint, khác tham số).
   */
  async thread(psid: string, platform = '', limit = 50): Promise<Record<string, unknown>> {
    const { pageId, token } = this.cfg();
    if (pageId && token) {
      try {
        const igPart = platform === 'instagram' ? '&platform=instagram' : '';
        const res = await fetch(
          `${GRAPH}/${pageId}/conversations?user_id=${encodeURIComponent(psid)}${igPart}` +
            `&fields=messages.limit(${limit}){id,message,from,created_time,attachments}` +
            `&access_token=${encodeURIComponent(token)}`,
        );
        const body = (await res.json()) as Record<string, any>;
        const msgs = body?.data?.[0]?.messages?.data ?? [];
        for (const m of Array.isArray(msgs) ? msgs : []) {
          const fromId = String(m?.from?.id ?? '');
          await this.proc.addMessage({
            id: String(m?.id ?? ''),
            psid,
            // Tin của page là 'out', của khách là 'in'.
            direction: fromId && fromId !== psid ? 'out' : 'in',
            text: String(m?.message ?? ''),
            attachments: Array.isArray(m?.attachments?.data) ? m.attachments.data : null,
            createdAt: m?.created_time ?? undefined,
          });
        }
      } catch (e) {
        // Không kéo được lịch sử thì vẫn hiện những gì DB đang có.
        this.logger.warn(`Không kéo được hội thoại ${psid}: ${String(e)}`);
      }
    }
    return this.proc.listMessages(psid, limit);
  }

  /**
   * Đánh giá khách để lại trên fanpage (tab "Đề xuất"). Chỉ ĐỌC — Meta không cho
   * trả lời đánh giá qua API, nên phần này để theo dõi và phản hồi tay trên page.
   */
  async ratings(limit = 25): Promise<Record<string, unknown>[]> {
    const { pageId, token } = this.cfg();
    if (!pageId || !token) return [];
    const res = await fetch(
      `${GRAPH}/${pageId}/ratings?fields=reviewer,rating,review_text,recommendation_type,created_time` +
        `&limit=${limit}&access_token=${encodeURIComponent(token)}`,
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (body?.error) return [];
    return (Array.isArray(body?.data) ? body.data : []).map((r: any) => ({
      id: String(r.created_time ?? '') + String(r.reviewer?.id ?? ''),
      reviewerName: String(r.reviewer?.name ?? ''),
      rating: Number(r.rating ?? 0),
      text: String(r.review_text ?? ''),
      // Meta bỏ sao 1-5 từ 2018, giờ chỉ còn recommended / not_recommended.
      recommendation: String(r.recommendation_type ?? ''),
      createdTime: r.created_time ?? null,
    }));
  }

  /**
   * Form thu lead (Lead Ads) + các lead đã điền. Dùng khi tiệm chạy quảng cáo
   * "để lại SĐT nhận ưu đãi" — lead về thẳng app thay vì phải tải CSV từ Meta.
   */
  async leads(limit = 50): Promise<Record<string, unknown>[]> {
    const { pageId, token } = this.cfg();
    if (!pageId || !token) return [];
    const formsRes = await fetch(
      `${GRAPH}/${pageId}/leadgen_forms?fields=id,name&limit=25&access_token=${encodeURIComponent(token)}`,
    );
    const forms = (await formsRes.json().catch(() => ({}))) as Record<string, any>;
    const out: Record<string, unknown>[] = [];
    for (const f of Array.isArray(forms?.data) ? forms.data : []) {
      const res = await fetch(
        `${GRAPH}/${f.id}/leads?limit=${limit}&access_token=${encodeURIComponent(token)}`,
      );
      const body = (await res.json().catch(() => ({}))) as Record<string, any>;
      for (const l of Array.isArray(body?.data) ? body.data : []) {
        const fields: Record<string, string> = {};
        for (const fd of Array.isArray(l.field_data) ? l.field_data : []) {
          fields[String(fd.name)] = String((fd.values ?? [])[0] ?? '');
        }
        out.push({
          id: String(l.id ?? ''),
          formName: String(f.name ?? ''),
          createdTime: l.created_time ?? null,
          name: fields.full_name ?? fields.name ?? '',
          phone: fields.phone_number ?? fields.phone ?? '',
          email: fields.email ?? '',
          fields,
        });
      }
    }
    return out;
  }

  /**
   * Số liệu fanpage cho thẻ KPI (Insights API): lượt xem page, tương tác bài, follow mới.
   * Metric của Meta hay bị khai tử theo phiên bản nên gọi TỪNG cái và bỏ qua cái lỗi,
   * thay vì để một metric chết làm hỏng cả khối.
   */
  async pageInsights(): Promise<Record<string, number>> {
    const { pageId, token } = this.cfg();
    if (!pageId || !token) return {};
    const metrics = ['page_views_total', 'page_post_engagements', 'page_daily_follows'];
    const out: Record<string, number> = {};
    for (const m of metrics) {
      try {
        const res = await fetch(
          `${GRAPH}/${pageId}/insights?metric=${m}&period=day&access_token=${encodeURIComponent(token)}`,
        );
        const body = (await res.json()) as { data?: { values?: { value?: number }[] }[] };
        const values = body?.data?.[0]?.values ?? [];
        out[m] = Number(values[values.length - 1]?.value ?? 0);
      } catch {
        // metric bị Meta bỏ ở phiên bản này → coi như không có
      }
    }
    return out;
  }

  /**
   * Trạng thái kết nối để hiện ở màn "Kết nối đa kênh": page nào, token còn sống không,
   * đang có những quyền gì, webhook đăng ký sự kiện nào. Giúp tự chẩn đoán khi tin không tới
   * (đúng loại lỗi đã gặp: webhook có URL nhưng KHÔNG đăng ký field nào nên Meta không đẩy gì).
   */
  async connectionStatus(): Promise<Record<string, unknown>> {
    const { pageId, token, secret } = this.cfg();
    if (!pageId || !token) return { configured: false };

    const out: Record<string, unknown> = { configured: true, pageId };
    try {
      const meRes = await fetch(
        `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
      );
      const me = (await meRes.json()) as { name?: string; error?: { message?: string } };
      out.pageName = me?.name ?? '';
      out.tokenValid = !me?.error;
      if (me?.error) out.tokenError = me.error.message;
    } catch (e) {
      out.tokenValid = false;
      out.tokenError = e instanceof Error ? e.message : String(e);
    }

    if (secret) {
      const appToken = `${process.env.FACEBOOK_APP_ID ?? ''}|${secret}`;
      try {
        const dbg = await fetch(
          `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}` +
            `&access_token=${encodeURIComponent(appToken)}`,
        );
        const d = (await dbg.json()) as { data?: { scopes?: string[]; expires_at?: number } };
        out.scopes = d?.data?.scopes ?? [];
        out.expiresAt = d?.data?.expires_at ?? 0; // 0 = không hết hạn
      } catch {
        out.scopes = [];
      }
      try {
        const subs = await fetch(
          `${GRAPH}/${process.env.FACEBOOK_APP_ID ?? ''}/subscriptions` +
            `?access_token=${encodeURIComponent(appToken)}`,
        );
        const d = (await subs.json()) as { data?: { object?: string; fields?: { name?: string }[] }[] };
        const page = (d?.data ?? []).find((x) => x.object === 'page');
        out.webhookFields = (page?.fields ?? []).map((f) => f.name).filter(Boolean);
      } catch {
        out.webhookFields = [];
      }
    }

    // Quyền cần cho từng nhóm tính năng → FE hiện đúng cái nào dùng được.
    const scopes = (out.scopes as string[]) ?? [];
    out.can = {
      messaging: scopes.includes('pages_messaging'),
      readComments: scopes.includes('pages_read_engagement'),
      manageComments: scopes.includes('pages_manage_engagement'),
    };
    return out;
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
    // Lấy ảnh + tên cho người chưa có (chạy nền, không để chậm nút Đồng bộ).
    void this.refreshProfiles().catch(() => undefined);
    return { synced };
  }

  // ── Danh sách + gửi tin ────────────────────────────────────
  async listContacts(filter: string, limit: number, offset: number, platform = '') {
    const f = ['window', 'optin'].includes(filter) ? filter : '';
    const p = ['facebook', 'instagram'].includes(platform) ? platform : '';
    const res = await this.proc.listContacts(
      f,
      Math.min(Math.max(limit, 1), 500),
      Math.max(offset, 0),
      p,
    );
    // Ai chưa có ảnh thì kéo hồ sơ về NGẦM (mỗi lượt 40 người, cách nhau ≥5 phút):
    // mở hộp thư vài lần là avatar đủ dần, không phải chờ bấm Đồng bộ.
    if (res.items.some((c) => !c.profilePic) && Date.now() - this.lastProfileSweep > 5 * 60_000) {
      this.lastProfileSweep = Date.now();
      void this.refreshProfiles().catch(() => undefined);
    }
    return res;
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
