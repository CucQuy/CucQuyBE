import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../auth/roles.decorator';
import { IpThrottlerGuard } from '../../common/ip-throttler.guard';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { FacebookService } from './facebook.service';
import { FacebookCommentsService } from './facebook-comments.service';
import { InstagramService } from './instagram.service';
import { SocialPostsService } from './social-posts.service';

/** Webhook Facebook — PUBLIC (Meta gọi tới, không có token đăng nhập). */
@ApiTags('Facebook')
@Controller('webhooks/facebook')
export class FacebookWebhookController {
  constructor(private readonly service: FacebookService) {}

  /**
   * Meta gọi 1 lần khi khai webhook: phải trả ĐÚNG chuỗi hub.challenge dạng TEXT THÔ.
   * Dùng @Res() để bypass envelope {data,message,...} toàn cục — trả JSON là Meta báo
   * "The URL couldn't be validated".
   */
  @Public()
  @UseGuards(IpThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    const value = this.service.verifyWebhook(mode, token, challenge);
    res.status(200).type('text/plain').send(value);
  }

  /**
   * Sự kiện tin nhắn. Meta chỉ cần 200 NHANH nên xử lý xong mới trả (payload nhỏ).
   * Chữ ký sai → 403 (chặn người lạ POST giả).
   */
  @Public()
  @Post()
  async receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: Record<string, any>,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.service.verifySignature(req.rawBody, req.header('x-hub-signature-256'))) {
      throw new ForbiddenException('FB_BAD_SIGNATURE');
    }
    await this.service.handleWebhook(body ?? {});
    // Meta chỉ cần 200 + text thô, không cần envelope.
    res.status(200).type('text/plain').send('EVENT_RECEIVED');
  }
}

/** API nội bộ (cần đăng nhập) cho màn khách Facebook. */
@ApiTags('Facebook')
@Controller('facebook')
@UseGuards(SsoAuthGuard)
export class FacebookController {
  constructor(
    private readonly service: FacebookService,
    private readonly comments: FacebookCommentsService,
    private readonly instagram: InstagramService,
    private readonly posts: SocialPostsService,
  ) {}

  /**
   * Danh sách khách đã inbox page. filter: window (còn 24h) | optin | '' (tất cả).
   * platform: facebook | instagram | '' — tách 2 màn Facebook / Instagram.
   */
  @Get('contacts')
  contacts(
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('platform') platform?: string,
  ) {
    return this.service.listContacts(
      String(filter ?? ''),
      Number(limit) || 100,
      Number(offset) || 0,
      String(platform ?? ''),
    );
  }

  /** Trạng thái kết nối: page, token, quyền, webhook fields — cho tab "Kết nối". */
  @Get('status')
  status() {
    return this.service.connectionStatus();
  }

  /** Kéo lại danh sách hội thoại từ Facebook (bổ sung khách mới / cập nhật mốc 24h). */
  @Post('sync')
  sync() {
    return this.service.syncConversations();
  }

  // ── Bình luận fanpage ────────────────────────────────────
  /**
   * Danh sách bình luận (gồm cả Instagram).
   * filter: pending | hidden | replied | '' — platform: facebook | instagram | '' (cả hai).
   */
  @Get('comments')
  listComments(
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('platform') platform?: string,
  ) {
    return this.comments.list(
      String(filter ?? ''),
      Number(limit) || 50,
      Number(offset) || 0,
      String(platform ?? ''),
    );
  }

  /** Kéo bài đăng + bình luận mới nhất từ Facebook về. */
  @Post('comments/sync')
  syncComments(@Body() body: { postLimit?: number }) {
    return this.comments.sync(Number(body?.postLimit) || 10);
  }

  /** Trả lời CÔNG KHAI dưới bình luận. */
  @Post('comments/:id/reply')
  replyComment(@Param('id') id: string, @Body() body: { message?: string }) {
    return this.comments.reply(id, String(body?.message ?? ''));
  }

  /** Nhắn RIÊNG người bình luận — mở cửa sổ 24h với họ. */
  @Post('comments/:id/private-reply')
  privateReply(@Param('id') id: string, @Body() body: { message?: string }) {
    return this.comments.privateReply(id, String(body?.message ?? ''));
  }

  /** Ẩn / bỏ ẩn bình luận. */
  @Post('comments/:id/hide')
  hideComment(@Param('id') id: string, @Body() body: { hidden?: boolean }) {
    return this.comments.setHidden(id, body?.hidden !== false);
  }

  /** Xoá hẳn bình luận (không hoàn tác). */
  @Delete('comments/:id')
  deleteComment(@Param('id') id: string) {
    return this.comments.remove(id);
  }

  /**
   * Số liệu fanpage + Instagram cho thẻ KPI ngoài Dashboard.
   * Gộp 1 endpoint để FE chỉ gọi 1 lần; phần nào lỗi thì trả 0, không làm hỏng cả thẻ.
   */
  @Get('insights')
  async insights() {
    const [page, ig] = await Promise.all([
      this.service.pageInsights().catch(() => ({})),
      this.instagram.insights().catch(() => ({})),
    ]);
    return {
      pageViews: Number((page as Record<string, number>).page_views_total ?? 0),
      postEngagements: Number((page as Record<string, number>).page_post_engagements ?? 0),
      newFollows: Number((page as Record<string, number>).page_daily_follows ?? 0),
      igReach: Number((ig as Record<string, number>).reach ?? 0),
    };
  }

  /** Đánh giá khách để lại trên fanpage (chỉ đọc — Meta không cho trả lời qua API). */
  @Get('ratings')
  ratings(@Query('limit') limit?: string) {
    return this.service.ratings(Number(limit) || 25);
  }

  /** Lead từ quảng cáo thu SĐT (Lead Ads) — khỏi phải tải CSV từ Meta. */
  @Get('leads')
  leads(@Query('limit') limit?: string) {
    return this.service.leads(Number(limit) || 50);
  }

  // ── Instagram (cùng page token) ──────────────────────────
  /** Hồ sơ tài khoản Instagram gắn với page — null nghĩa là chưa nối. */
  @Get('instagram')
  igProfile() {
    return this.instagram.profile();
  }

  /** Kéo hội thoại Instagram Direct về danh sách khách. */
  @Post('instagram/sync')
  igSync() {
    return this.instagram.syncConversations();
  }

  /** Kéo RIÊNG bài + bình luận Instagram (màn Instagram · Bình luận). */
  @Post('instagram/comments/sync')
  igSyncComments(@Body() body: { mediaLimit?: number }) {
    return this.instagram.syncComments(Number(body?.mediaLimit) || 12);
  }

  // ── Đăng bài lên fanpage + Instagram ─────────────────────
  /** Danh sách bài đã soạn: nháp, đã hẹn giờ, đã đăng, lỗi. */
  @Get('posts')
  listPosts(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.posts.list(Number(limit) || 50, Number(offset) || 0);
  }

  /**
   * Lưu bài. publishNow=true → đăng ngay; có scheduledAt → hẹn giờ; còn lại là nháp.
   * targets: ['facebook'] | ['instagram'] | cả hai. Instagram bắt buộc có imageUrl.
   */
  @Post('posts')
  savePost(
    @Req() req: Request & { user?: { email?: string } },
    @Body()
    body: {
      id?: string;
      message?: string;
      imageUrl?: string;
      targets?: string[];
      scheduledAt?: string;
      publishNow?: boolean;
    },
  ) {
    return this.posts.save(body ?? {}, req.user?.email);
  }

  /** Đăng ngay 1 bài đã lưu (nháp hoặc bài hẹn giờ muốn đẩy sớm). */
  @Post('posts/:id/publish')
  publishPost(@Param('id') id: string) {
    return this.posts.publish(id);
  }

  /** Xoá bài chưa đăng (bài đã đăng thì phải xoá trên Facebook/Instagram). */
  @Delete('posts/:id')
  deletePost(@Param('id') id: string) {
    return this.posts.remove(id);
  }

  /** Cấu hình luật tự động (ẩn SĐT/từ khoá, trả lời, nhắn riêng). */
  @Get('config')
  getConfig() {
    return this.comments.getConfig();
  }

  @Put('config')
  saveConfig(@Body() body: Record<string, unknown>) {
    return this.comments.saveConfig(body ?? {});
  }

  /**
   * Gửi tin cho 1 hoặc nhiều khách: text và/hoặc ảnh (URL https công khai).
   * Có buttonTitle + buttonUrl → gửi dạng THẺ (ảnh + tiêu đề + nút bấm).
   * Trả kết quả từng người (sent / lý do lỗi).
   */
  @Post('send')
  send(
    @Body()
    body: {
      psids?: string[];
      text?: string;
      imageUrl?: string;
      buttonTitle?: string;
      buttonUrl?: string;
    },
  ) {
    const psids = Array.isArray(body?.psids) ? body.psids.filter(Boolean).map(String) : [];
    if (psids.length === 0) throw new BadRequestException('Chưa chọn khách nào');
    return this.service.sendMessage(psids, {
      text: body?.text,
      imageUrl: body?.imageUrl,
      buttonTitle: body?.buttonTitle,
      buttonUrl: body?.buttonUrl,
    });
  }
}
