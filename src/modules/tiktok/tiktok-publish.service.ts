import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TiktokProc } from './tiktok.proc';
import { TiktokService } from './tiktok.service';
import type { TiktokPrivacyLevel, TiktokPublish } from './tiktok.types';

const PRIVACY: TiktokPrivacyLevel[] = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
];

/**
 * Đăng video lên TikTok từ app (Content Posting API).
 *
 * Hai chế độ, khác nhau ở quyền TikTok đã duyệt cho app:
 * - `inbox`  (scope `video.upload`) — video rơi vào hộp nháp trong app TikTok, chủ tiệm
 *   mở app bấm đăng. App mới xin được quyền này trước.
 * - `direct` (scope `video.publish`) — đăng thẳng lên profile, phải qua audit của TikTok.
 *
 * Video gửi bằng PULL_FROM_URL: TikTok tự tải từ URL https công khai (dùng link
 * RiceService sẵn có trong app) → không phải stream file qua backend.
 * ⚠️ Domain chứa video phải được verify trong TikTok Developer Portal, nếu không
 * TikTok từ chối với `url_ownership_unverified`.
 *
 * Đăng là BẤT ĐỒNG BỘ: init chỉ trả `publish_id`, phải hỏi /status/fetch/ mới biết
 * kết quả → bài để `processing`, worker mỗi phút hỏi lại.
 */
@Injectable()
export class TiktokPublishService {
  private readonly logger = new Logger(TiktokPublishService.name);

  constructor(
    private readonly proc: TiktokProc,
    private readonly tiktok: TiktokService,
  ) {}

  list(limit = 50, offset = 0): Promise<TiktokPublish[]> {
    return this.proc.listPublishes(Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
  }

  /**
   * Thông tin người đăng do TikTok trả về: mức riêng tư được phép, giới hạn độ dài,
   * bài đang chờ duyệt... TikTok BẮT BUỘC hiện những thứ này trước khi cho đăng.
   */
  async creatorInfo(): Promise<Record<string, unknown>> {
    const r = await this.tiktok.api('/v2/post/publish/creator_info/query/', { method: 'POST' });
    const d = (r?.data ?? {}) as Record<string, any>;
    return {
      nickname: String(d.creator_nickname ?? ''),
      username: String(d.creator_username ?? ''),
      avatarUrl: String(d.creator_avatar_url ?? ''),
      privacyOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options : [],
      commentDisabled: d.comment_disabled === true,
      duetDisabled: d.duet_disabled === true,
      stitchDisabled: d.stitch_disabled === true,
      maxVideoSeconds: Number(d.max_video_post_duration_sec ?? 0),
    };
  }

  /**
   * Lưu bài đăng. `publishNow` → gửi TikTok luôn; có `scheduledAt` → xếp hàng đợi
   * (TikTok không có hẹn giờ, app tự cầm); còn lại là nháp.
   */
  async save(
    data: {
      id?: string;
      title?: string;
      videoUrl?: string;
      mode?: string;
      privacyLevel?: string;
      disableComment?: boolean;
      disableDuet?: boolean;
      disableStitch?: boolean;
      scheduledAt?: string;
      publishNow?: boolean;
    },
    createdBy?: string,
  ): Promise<Record<string, unknown> | null> {
    const videoUrl = String(data.videoUrl ?? '').trim();
    if (!/^https:\/\//i.test(videoUrl)) throw new BadRequestException('Cần link video https');

    const mode = data.mode === 'direct' ? 'direct' : 'inbox';
    const privacyLevel = PRIVACY.includes(data.privacyLevel as TiktokPrivacyLevel)
      ? (data.privacyLevel as TiktokPrivacyLevel)
      : 'SELF_ONLY';

    const saved = await this.proc.savePublish({
      id: data.id,
      title: String(data.title ?? '').trim(),
      videoUrl,
      mode,
      privacyLevel,
      disableComment: data.disableComment === true,
      disableDuet: data.disableDuet === true,
      disableStitch: data.disableStitch === true,
      scheduledAt: data.publishNow ? null : (data.scheduledAt ?? null),
      status: !data.publishNow && data.scheduledAt ? 'scheduled' : 'draft',
      createdBy,
    });

    if (data.publishNow) return this.publish(String(saved?.id ?? ''));
    return saved as unknown as Record<string, unknown>;
  }

  /** Gửi 1 bài lên TikTok. Lỗi được ghi vào bài (status `failed`) để màn hình thấy lý do. */
  async publish(id: string): Promise<Record<string, unknown> | null> {
    const post = await this.proc.getPublish(id);
    if (!post) throw new BadRequestException('Không tìm thấy bài đăng');

    const direct = post.mode === 'direct';
    await this.tiktok.requireScope(direct ? 'video.publish' : 'video.upload');

    const body: Record<string, unknown> = {
      source_info: { source: 'PULL_FROM_URL', video_url: post.videoUrl },
    };
    // Chỉ chế độ direct mới khai post_info — inbox để người dùng tự đặt trong app TikTok.
    if (direct) {
      body.post_info = {
        title: post.title,
        privacy_level: post.privacyLevel,
        disable_comment: post.disableComment,
        disable_duet: post.disableDuet,
        disable_stitch: post.disableStitch,
      };
    }

    try {
      const r = await this.tiktok.api(
        direct ? '/v2/post/publish/video/init/' : '/v2/post/publish/inbox/video/init/',
        { method: 'POST', body },
      );
      const publishId = String(r?.data?.publish_id ?? '');
      if (!publishId) throw new Error('TikTok không trả publish_id');
      await this.proc.markPublish(id, 'processing', publishId, '', '');
      this.logger.log(`Gửi video TikTok ${id} → publish_id ${publishId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.proc.markPublish(id, 'failed', '', '', msg);
    }

    return this.proc.getPublish(id) as unknown as Promise<Record<string, unknown> | null>;
  }

  /**
   * Hỏi TikTok kết quả của 1 bài đang `processing`.
   * TikTok trả `PROCESSING_UPLOAD` / `PUBLISH_COMPLETE` / `FAILED` — chỉ 2 trạng thái sau
   * là kết thúc, nên bài vẫn `processing` cho tới lúc đó.
   */
  async refresh(id: string): Promise<Record<string, unknown> | null> {
    const post = await this.proc.getPublish(id);
    if (!post?.publishId) return post as unknown as Record<string, unknown> | null;

    try {
      const r = await this.tiktok.api('/v2/post/publish/status/fetch/', {
        method: 'POST',
        body: { publish_id: post.publishId },
      });
      const d = (r?.data ?? {}) as Record<string, any>;
      const status = String(d.status ?? '');
      const videoId = Array.isArray(d.publicaly_available_post_id)
        ? String(d.publicaly_available_post_id[0] ?? '')
        : '';

      if (status === 'PUBLISH_COMPLETE') {
        await this.proc.markPublish(id, 'published', '', videoId, '');
      } else if (status === 'FAILED') {
        await this.proc.markPublish(id, 'failed', '', '', String(d.fail_reason ?? 'FAILED'));
      }
    } catch (e) {
      await this.proc.markPublish(id, '', '', '', e instanceof Error ? e.message : String(e));
    }

    return this.proc.getPublish(id) as unknown as Promise<Record<string, unknown> | null>;
  }

  remove(id: string): Promise<void> {
    return this.proc.deletePublish(id);
  }

  /** Bài tới giờ hẹn + bài đang chờ TikTok xử lý — gọi từ tick mỗi phút của hàng đợi lịch. */
  async runScheduled(): Promise<void> {
    let due: TiktokPublish[] = [];
    let pending: TiktokPublish[] = [];
    try {
      [due, pending] = await Promise.all([this.proc.duePublishes(), this.proc.pendingPublishes()]);
    } catch {
      return;
    }

    for (const p of due) {
      await this.publish(p.id).catch((e) =>
        this.logger.warn(`Đăng TikTok ${p.id} lỗi: ${String(e)}`),
      );
    }
    for (const p of pending) {
      await this.refresh(p.id).catch(() => undefined);
    }
  }
}
