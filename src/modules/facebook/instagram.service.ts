import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FacebookProc } from './facebook.proc';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Thiếu quyền → FE hiện hướng dẫn lấy token mới (dùng chung mã lỗi với Facebook). */
export const FB_MISSING_PERMISSION = 'FB_MISSING_PERMISSION';

/**
 * Instagram Business (@tiembanhcucquy) — nối sẵn với fanpage nên dùng CHUNG page token
 * và chung bảng `facebook_*` (phân biệt bằng cột `platform`).
 *
 * Khác Facebook ở đường dẫn Graph:
 * - bài đăng: `/{ig-user}/media` (không phải `/feed`), field `caption` thay `message`
 * - bình luận: field `text` thay `message`, `hidden` thay `is_hidden`
 * - trả lời: `POST /{comment}/replies` (Facebook là `/{comment}/comments`)
 * - ẩn: `POST /{comment} {hide:true}` (Facebook là `{is_hidden:true}`)
 */
@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  /** id tài khoản IG — hỏi Graph 1 lần rồi nhớ, tránh gọi lại mỗi thao tác. */
  private igUserId: string | null = null;

  constructor(private readonly proc: FacebookProc) {}

  private token(): string {
    const t = String(process.env.FACEBOOK_PAGE_TOKEN ?? '').trim();
    if (!t) throw new BadRequestException('FACEBOOK_NOT_CONFIGURED');
    return t;
  }

  private async graph(
    path: string,
    init?: { method?: string; body?: Record<string, unknown> },
  ): Promise<Record<string, any>> {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(this.token())}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    const err = body?.error;
    if (err) {
      const msg = String(err.message ?? '');
      if (err.code === 200 || /permission/i.test(msg)) throw new BadRequestException(FB_MISSING_PERMISSION);
      throw new BadRequestException(msg || 'IG_API_ERROR');
    }
    return body;
  }

  /** id tài khoản Instagram gắn với fanpage; null nghĩa là page chưa nối IG. */
  async accountId(): Promise<string | null> {
    if (this.igUserId) return this.igUserId;
    const pageId = String(process.env.FACEBOOK_PAGE_ID ?? '').trim();
    if (!pageId) return null;
    const r = await this.graph(`/${pageId}?fields=instagram_business_account`);
    const id = r?.instagram_business_account?.id;
    this.igUserId = id ? String(id) : null;
    return this.igUserId;
  }

  /** Hồ sơ tài khoản IG cho màn "Kết nối". */
  async profile(): Promise<Record<string, unknown> | null> {
    const ig = await this.accountId();
    if (!ig) return null;
    const r = await this.graph(
      `/${ig}?fields=id,username,name,followers_count,follows_count,media_count,profile_picture_url`,
    );
    return {
      id: String(r.id ?? ''),
      username: String(r.username ?? ''),
      name: String(r.name ?? ''),
      followers: Number(r.followers_count ?? 0),
      following: Number(r.follows_count ?? 0),
      mediaCount: Number(r.media_count ?? 0),
      avatar: String(r.profile_picture_url ?? ''),
    };
  }

  // ── Bình luận ──────────────────────────────────────────────
  /** Kéo bài + bình luận Instagram về cùng bảng với Facebook. */
  async syncComments(mediaLimit = 12): Promise<{ posts: number; comments: number }> {
    const ig = await this.accountId();
    if (!ig) return { posts: 0, comments: 0 };

    const feed = await this.graph(
      `/${ig}/media?fields=id,caption,permalink,timestamp,media_type,media_url,thumbnail_url,comments_count&limit=${mediaLimit}`,
    );
    const posts = Array.isArray(feed?.data) ? feed.data : [];
    let comments = 0;

    for (const m of posts) {
      await this.proc.upsertPost({
        id: String(m.id),
        message: m.caption ?? '',
        permalink: m.permalink ?? '',
        createdTime: m.timestamp ?? null,
        platform: 'instagram',
        mediaUrl: m.thumbnail_url ?? m.media_url ?? '',
        mediaType: m.media_type ?? '',
      });
      // Bài chưa có bình luận thì khỏi gọi thêm 1 request.
      if (!Number(m.comments_count ?? 0)) continue;

      const cmts = await this.graph(
        `/${m.id}/comments?fields=id,text,username,timestamp,hidden,from,parent_id&limit=50`,
      );
      for (const c of Array.isArray(cmts?.data) ? cmts.data : []) {
        await this.proc.upsertComment({
          id: String(c.id),
          postId: String(m.id),
          parentId: c.parent_id ?? '',
          psid: c.from?.id ?? '',
          fromName: c.username ?? c.from?.username ?? '',
          message: c.text ?? '',
          isHidden: c.hidden === true,
          createdTime: c.timestamp ?? null,
          platform: 'instagram',
          raw: c,
        });
        comments += 1;
      }
    }
    this.logger.log(`Đồng bộ Instagram: ${posts.length} bài, ${comments} bình luận`);
    return { posts: posts.length, comments };
  }

  /** Trả lời công khai dưới bình luận IG. */
  async reply(commentId: string, message: string): Promise<{ id: string }> {
    const text = String(message ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung trả lời trống');
    const r = await this.graph(`/${commentId}/replies`, { method: 'POST', body: { message: text } });
    return { id: String(r?.id ?? '') };
  }

  /** Ẩn / bỏ ẩn bình luận IG (IG dùng field `hide`, Facebook dùng `is_hidden`). */
  async setHidden(commentId: string, hidden: boolean): Promise<void> {
    await this.graph(`/${commentId}`, { method: 'POST', body: { hide: hidden } });
  }

  async remove(commentId: string): Promise<void> {
    await this.graph(`/${commentId}`, { method: 'DELETE' });
  }

  /**
   * Nhắn riêng người bình luận IG. Cửa sổ của Instagram là 7 NGÀY kể từ bình luận
   * (rộng hơn Messenger), gửi qua chính endpoint messages của page.
   */
  async privateReply(commentId: string, message: string): Promise<void> {
    const text = String(message ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung tin trống');
    const pageId = String(process.env.FACEBOOK_PAGE_ID ?? '').trim();
    await this.graph(`/${pageId}/messages`, {
      method: 'POST',
      body: { recipient: { comment_id: commentId }, message: { text } },
    });
  }

  // ── Inbox ──────────────────────────────────────────────────
  /** Kéo hội thoại Instagram Direct về bảng contacts (platform='instagram'). */
  async syncConversations(limit = 50): Promise<{ contacts: number }> {
    const pageId = String(process.env.FACEBOOK_PAGE_ID ?? '').trim();
    const r = await this.graph(
      `/${pageId}/conversations?platform=instagram&fields=participants,updated_time,message_count&limit=${limit}`,
    );
    let n = 0;
    for (const c of Array.isArray(r?.data) ? r.data : []) {
      const me = String(await this.accountId());
      const other = (c.participants?.data ?? []).find((p: any) => String(p.id) !== me);
      if (!other?.id) continue;
      await this.proc.upsertContact({
        psid: String(other.id),
        name: other.username ?? other.name ?? '',
        lastInboundAt: c.updated_time ?? null,
        messageCount: Number(c.message_count ?? 0),
        platform: 'instagram',
      });
      n += 1;
    }
    this.logger.log(`Đồng bộ Instagram Direct: ${n} người`);
    return { contacts: n };
  }

  // ── Số liệu ────────────────────────────────────────────────
  /** Reach + lượt xem hồ sơ IG cho thẻ KPI. */
  async insights(): Promise<Record<string, number>> {
    const ig = await this.accountId();
    if (!ig) return {};
    const r = await this.graph(`/${ig}/insights?metric=reach&period=day`);
    const out: Record<string, number> = {};
    for (const m of Array.isArray(r?.data) ? r.data : []) {
      const values = Array.isArray(m.values) ? m.values : [];
      out[String(m.name)] = Number(values[values.length - 1]?.value ?? 0);
    }
    return out;
  }
}
