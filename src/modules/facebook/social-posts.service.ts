import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FacebookProc } from './facebook.proc';
import { InstagramService } from './instagram.service';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Đăng bài lên fanpage + Instagram từ app: soạn 1 lần, chọn kênh, đăng ngay hoặc hẹn giờ.
 *
 * Facebook có hẹn giờ native nhưng Instagram KHÔNG, nên hẹn giờ do app tự cầm:
 * bài để trạng thái 'scheduled', cron mỗi phút quét bài tới giờ rồi mới gọi Graph.
 * Cách này cũng cho phép sửa/huỷ bài đã hẹn ngay trong app.
 *
 * Instagram BẮT BUỘC có ảnh và ảnh phải là URL https công khai (Meta tự tải về),
 * nên ảnh dùng link RiceService sẵn có trong app.
 */
@Injectable()
export class SocialPostsService {
  private readonly logger = new Logger(SocialPostsService.name);

  constructor(
    private readonly proc: FacebookProc,
    private readonly instagram: InstagramService,
  ) {}

  private cfg() {
    return {
      pageId: String(process.env.FACEBOOK_PAGE_ID ?? '').trim(),
      token: String(process.env.FACEBOOK_PAGE_TOKEN ?? '').trim(),
    };
  }

  private async graph(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    const { token } = this.cfg();
    if (!token) throw new BadRequestException('FACEBOOK_NOT_CONFIGURED');
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (json?.error) throw new BadRequestException(String(json.error.message ?? 'FB_API_ERROR'));
    return json;
  }

  list(limit = 50, offset = 0) {
    return this.proc.listSocialPosts(Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
  }

  /**
   * Lưu bài. `publishNow` → đăng luôn; có `scheduledAt` → xếp hàng đợi;
   * còn lại là nháp (soạn dở, lưu lại đăng sau).
   */
  async save(
    data: {
      id?: string;
      message?: string;
      imageUrl?: string;
      targets?: string[];
      scheduledAt?: string;
      publishNow?: boolean;
    },
    createdBy?: string,
  ): Promise<Record<string, unknown>> {
    const targets = (Array.isArray(data.targets) ? data.targets : ['facebook']).filter((t) =>
      ['facebook', 'instagram'].includes(t),
    );
    if (targets.length === 0) throw new BadRequestException('Chưa chọn kênh đăng');
    const message = String(data.message ?? '').trim();
    const imageUrl = String(data.imageUrl ?? '').trim();
    if (!message && !imageUrl) throw new BadRequestException('Bài trống');
    if (targets.includes('instagram') && !imageUrl) {
      throw new BadRequestException('Instagram bắt buộc có ảnh');
    }

    const status = data.publishNow ? 'draft' : data.scheduledAt ? 'scheduled' : 'draft';
    const saved = await this.proc.saveSocialPost({
      id: data.id,
      message,
      imageUrl,
      targets,
      scheduledAt: data.publishNow ? null : (data.scheduledAt ?? null),
      status,
      createdBy,
    });

    if (data.publishNow) return this.publish(String(saved?.id ?? ''));
    return saved;
  }

  /** Đăng 1 bài lên các kênh đã chọn. Kênh nào lỗi thì ghi lỗi, kênh kia vẫn đăng. */
  async publish(id: string): Promise<Record<string, unknown>> {
    const posts = await this.proc.listSocialPosts(200, 0);
    const post = (Array.isArray(posts) ? posts : []).find(
      (p: Record<string, unknown>) => String(p.id) === id,
    );
    if (!post) throw new BadRequestException('Không tìm thấy bài');

    const message = String(post.message ?? '');
    const imageUrl = String(post.imageUrl ?? '');
    const targets = Array.isArray(post.targets) ? (post.targets as string[]) : [];
    const remote: Record<string, string> = {};
    const errors: string[] = [];

    if (targets.includes('facebook')) {
      try {
        const { pageId } = this.cfg();
        // Có ảnh → /photos (bài ảnh), không thì /feed (bài chữ).
        const r = imageUrl
          ? await this.graph(`/${pageId}/photos`, { url: imageUrl, caption: message })
          : await this.graph(`/${pageId}/feed`, { message });
        remote.facebook = String(r?.post_id ?? r?.id ?? '');
      } catch (e) {
        errors.push(`Facebook: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (targets.includes('instagram')) {
      try {
        const ig = await this.instagram.accountId();
        if (!ig) throw new Error('Fanpage chưa nối Instagram');
        // IG đăng 2 bước: tạo "container" rồi publish container đó.
        const container = await this.graph(`/${ig}/media`, { image_url: imageUrl, caption: message });
        const published = await this.graph(`/${ig}/media_publish`, {
          creation_id: String(container?.id ?? ''),
        });
        remote.instagram = String(published?.id ?? '');
      } catch (e) {
        errors.push(`Instagram: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const ok = Object.keys(remote).length > 0;
    await this.proc.markSocialPost(
      id,
      ok && errors.length === 0 ? 'published' : ok ? 'published' : 'failed',
      remote,
      errors.join(' · '),
    );
    this.logger.log(`Đăng bài ${id}: ${JSON.stringify(remote)} ${errors.join(' · ')}`);
    return { id, remoteIds: remote, errors };
  }

  remove(id: string) {
    return this.proc.deleteSocialPost(id);
  }

  /** Đăng các bài đã tới giờ hẹn — gọi từ tick mỗi phút của hàng đợi lịch. */
  async runScheduled(): Promise<void> {
    let due: Record<string, unknown>[] = [];
    try {
      due = await this.proc.dueSocialPosts();
    } catch {
      return;
    }
    for (const p of due) {
      try {
        await this.publish(String(p.id));
      } catch (e) {
        await this.proc
          .markSocialPost(String(p.id), 'failed', null, e instanceof Error ? e.message : String(e))
          .catch(() => undefined);
      }
    }
  }
}
