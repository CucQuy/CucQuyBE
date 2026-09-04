import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FacebookProc } from './facebook.proc';
import { InstagramService } from './instagram.service';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Lỗi thiếu quyền token → FE hiện hướng dẫn lấy token mới thay vì báo đỏ chung chung. */
export const FB_MISSING_PERMISSION = 'FB_MISSING_PERMISSION';

/** SĐT Việt Nam trong bình luận: 0/84 + 9-10 số, chịu cả dấu cách, chấm, gạch giữa các cụm. */
const PHONE_RE = /(?:^|[^\d])((?:\+?84|0)[\s.\-]?\d{2,3}[\s.\-]?\d{3}[\s.\-]?\d{3,4})(?:$|[^\d])/;

/** Bỏ dấu + lowercase để khớp từ khoá kiểu "SHOP ĐỐI THỦ" ~ "shop doi thu". */
const norm = (s: string): string =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();

/**
 * Quản lý bình luận fanpage qua Graph API: đồng bộ, trả lời công khai, ẩn/bỏ ẩn, xoá,
 * nhắn riêng người bình luận, và các luật tự động chạy khi webhook `feed` báo có bình luận mới.
 *
 * Abit không hỗ trợ phần này (webhook của họ chỉ đẩy comment, không có API ẩn/trả lời),
 * nên đi thẳng Meta. Cần token có `pages_read_engagement` (đọc) và `pages_manage_engagement`
 * (trả lời/ẩn/xoá) — thiếu thì các hàm dưới ném FB_MISSING_PERMISSION.
 */
@Injectable()
export class FacebookCommentsService {
  private readonly logger = new Logger(FacebookCommentsService.name);

  constructor(
    private readonly proc: FacebookProc,
    private readonly instagram: InstagramService,
  ) {}

  /** Bình luận này thuộc Instagram? (đường dẫn Graph khác Facebook) */
  private async isInstagram(commentId: string): Promise<boolean> {
    const c = await this.proc.getComment(commentId);
    return String(c?.platform ?? '') === 'instagram';
  }

  private cfg() {
    return {
      pageId: String(process.env.FACEBOOK_PAGE_ID ?? '').trim(),
      token: String(process.env.FACEBOOK_PAGE_TOKEN ?? '').trim(),
    };
  }

  /** Gọi Graph, ném lỗi rõ nghĩa khi thiếu quyền (code 200 / 10 của Meta). */
  private async graph(
    path: string,
    init?: { method?: string; body?: Record<string, unknown> },
  ): Promise<Record<string, any>> {
    const { token } = this.cfg();
    if (!token) throw new BadRequestException('FACEBOOK_NOT_CONFIGURED');
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    const err = body?.error;
    if (err) {
      const msg = String(err.message ?? '');
      if (err.code === 200 || /permission/i.test(msg)) {
        throw new BadRequestException(FB_MISSING_PERMISSION);
      }
      throw new BadRequestException(msg || 'FB_API_ERROR');
    }
    return body;
  }

  // ── Đồng bộ ────────────────────────────────────────────────
  /**
   * Kéo bài + bình luận của CẢ fanpage và Instagram về DB.
   * IG lỗi (chưa nối tài khoản, thiếu quyền) không được làm hỏng phần Facebook.
   */
  async sync(postLimit = 10): Promise<{ posts: number; comments: number }> {
    const fb = await this.syncFacebook(postLimit);
    let ig = { posts: 0, comments: 0 };
    try {
      ig = await this.instagram.syncComments(postLimit);
    } catch (e) {
      this.logger.warn(`Bỏ qua đồng bộ Instagram: ${String(e)}`);
    }
    return { posts: fb.posts + ig.posts, comments: fb.comments + ig.comments };
  }

  /** Riêng phần fanpage Facebook. */
  private async syncFacebook(postLimit: number): Promise<{ posts: number; comments: number }> {
    const { pageId } = this.cfg();
    const feed = await this.graph(
      `/${pageId}/feed?fields=id,message,created_time,permalink_url&limit=${postLimit}`,
    );
    let comments = 0;
    const posts = Array.isArray(feed?.data) ? feed.data : [];

    for (const p of posts) {
      await this.proc.upsertPost({
        id: String(p.id),
        message: p.message ?? '',
        permalink: p.permalink_url ?? '',
        createdTime: p.created_time ?? null,
      });
      const cmts = await this.graph(
        `/${p.id}/comments?fields=id,message,from,created_time,is_hidden,parent&limit=50`,
      );
      for (const c of Array.isArray(cmts?.data) ? cmts.data : []) {
        await this.proc.upsertComment({
          id: String(c.id),
          postId: String(p.id),
          parentId: c.parent?.id ?? '',
          psid: c.from?.id ?? '',
          fromName: c.from?.name ?? '',
          message: c.message ?? '',
          isHidden: c.is_hidden === true,
          createdTime: c.created_time ?? null,
          raw: c,
        });
        comments += 1;
      }
    }
    this.logger.log(`Đồng bộ Facebook: ${posts.length} bài, ${comments} bình luận`);
    return { posts: posts.length, comments };
  }

  list(filter: string, limit: number, offset: number, platform = '') {
    const f = ['pending', 'hidden', 'replied'].includes(filter) ? filter : '';
    const p = ['facebook', 'instagram'].includes(platform) ? platform : '';
    return this.proc.listComments(f, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0), p);
  }

  // ── Thao tác trên 1 bình luận ──────────────────────────────
  /** Trả lời CÔNG KHAI dưới bình luận (Instagram dùng `/replies`). */
  async reply(commentId: string, message: string): Promise<{ id: string }> {
    const text = String(message ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung trả lời trống');
    const r = (await this.isInstagram(commentId))
      ? await this.instagram.reply(commentId, text)
      : await this.graph(`/${commentId}/comments`, { method: 'POST', body: { message: text } });
    await this.proc.markComment(commentId, null, true, null);
    return { id: String(r?.id ?? '') };
  }

  /** Ẩn / bỏ ẩn bình luận (Instagram dùng field `hide`, Facebook dùng `is_hidden`). */
  async setHidden(commentId: string, hidden: boolean): Promise<void> {
    if (await this.isInstagram(commentId)) await this.instagram.setHidden(commentId, hidden);
    else await this.graph(`/${commentId}`, { method: 'POST', body: { is_hidden: hidden } });
    await this.proc.markComment(commentId, hidden, null, null);
  }

  /** Xoá hẳn bình luận — KHÔNG hoàn tác được. */
  async remove(commentId: string): Promise<void> {
    if (await this.isInstagram(commentId)) await this.instagram.remove(commentId);
    else await this.graph(`/${commentId}`, { method: 'DELETE' });
    await this.proc.deleteComment(commentId);
  }

  /**
   * Nhắn RIÊNG người bình luận (private reply). Meta cho phép 1 lần cho mỗi bình luận và
   * việc này MỞ cửa sổ 24h với người đó → biến người bình luận thành khách nhắn tin được.
   */
  async privateReply(commentId: string, message: string): Promise<void> {
    const text = String(message ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung tin trống');
    if (await this.isInstagram(commentId)) {
      // Instagram cho nhắn riêng trong 7 ngày kể từ bình luận (rộng hơn Messenger 24h).
      await this.instagram.privateReply(commentId, text);
    } else {
      await this.graph(`/me/messages`, {
        method: 'POST',
        body: { recipient: { comment_id: commentId }, message: { text } },
      });
    }
    await this.proc.markComment(commentId, null, true, null);
  }

  // ── Cấu hình + luật tự động ────────────────────────────────
  getConfig() {
    return this.proc.commentConfig();
  }

  saveConfig(data: Record<string, unknown>) {
    return this.proc.saveCommentConfig(data);
  }

  /**
   * Chạy luật tự động cho 1 bình luận vừa tới (gọi từ webhook `feed`).
   * Thứ tự: ẩn (SĐT → từ khoá) rồi mới trả lời — ẩn xong vẫn trả lời được vì bình luận
   * chỉ ẩn với người ngoài. Mọi lỗi đều nuốt, không để hỏng webhook.
   */
  async runAutoRules(comment: {
    id: string;
    message: string;
    psid?: string;
  }): Promise<void> {
    try {
      const cfg = (await this.proc.commentConfig()) as Record<string, any>;
      const msg = String(comment.message ?? '');

      if (cfg?.autoHidePhone && PHONE_RE.test(msg)) {
        await this.setHidden(comment.id, true);
        await this.proc.markComment(comment.id, true, null, 'hide_phone');
        this.logger.log(`Tự ẩn bình luận có SĐT: ${comment.id}`);
      } else {
        const keywords: string[] = Array.isArray(cfg?.autoHideKeywords) ? cfg.autoHideKeywords : [];
        const hay = norm(msg);
        const hit = keywords.find((k) => k && hay.includes(norm(k)));
        if (hit) {
          await this.setHidden(comment.id, true);
          await this.proc.markComment(comment.id, true, null, 'hide_keyword');
          this.logger.log(`Tự ẩn bình luận theo từ khoá "${hit}": ${comment.id}`);
        }
      }

      if (cfg?.autoReplyEnabled && String(cfg?.autoReplyText ?? '').trim()) {
        await this.reply(comment.id, String(cfg.autoReplyText));
        await this.proc.markComment(comment.id, null, true, 'reply');
      }
      if (cfg?.autoPrivateReply && String(cfg?.privateReplyText ?? '').trim()) {
        await this.privateReply(comment.id, String(cfg.privateReplyText));
        await this.proc.markComment(comment.id, null, true, 'private_reply');
      }
    } catch (e) {
      this.logger.warn(`Luật tự động cho bình luận ${comment.id} lỗi: ${String(e)}`);
    }
  }
}
