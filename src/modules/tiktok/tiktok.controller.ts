import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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
import { TiktokService } from './tiktok.service';
import { TiktokPublishService } from './tiktok-publish.service';

/**
 * Nơi TikTok đá người dùng về sau màn cấp quyền — PUBLIC vì trình duyệt tới thẳng đây,
 * không kèm token đăng nhập của app. An toàn dựa vào `state` đã ký (xem TiktokService).
 */
@ApiTags('TikTok')
@Controller('tiktok/oauth')
export class TiktokOauthController {
  constructor(private readonly service: TiktokService) {}

  @Public()
  @UseGuards(IpThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ): Promise<void> {
    // Người dùng bấm "Huỷ" ở màn TikTok → về lại FE kèm lý do, không phải trang lỗi.
    if (error || !code) {
      res.redirect(this.service.returnUrl(`tiktok=cancelled`));
      return;
    }
    try {
      await this.service.connect(code, String(state ?? ''));
      res.redirect(this.service.returnUrl('tiktok=connected'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'TIKTOK_CONNECT_FAILED';
      res.redirect(this.service.returnUrl(`tiktok=failed&reason=${encodeURIComponent(msg)}`));
    }
  }
}

/** API nội bộ (cần đăng nhập) cho các màn TikTok trong "Kết nối đa kênh". */
@ApiTags('TikTok')
@Controller('tiktok')
@UseGuards(SsoAuthGuard)
export class TiktokController {
  constructor(
    private readonly service: TiktokService,
    private readonly publishes: TiktokPublishService,
  ) {}

  // ── Kết nối ──────────────────────────────────────────────
  /** Trạng thái: app đã cấu hình chưa, tài khoản nào đang nối, token có quyền gì. */
  @Get('status')
  status() {
    return this.service.status();
  }

  /** URL để FE chuyển hướng sang TikTok cấp quyền. */
  @Get('auth-url')
  authUrl(@Req() req: Request & { user?: { email?: string } }) {
    // Email đi kèm trong `state` đã ký — callback là endpoint public nên không hỏi lại được.
    return { url: this.service.authorizeUrl(req.user?.email ?? '') };
  }

  /** Kéo lại hồ sơ (follower/like/số video). */
  @Post('sync-profile')
  syncProfile() {
    return this.service.syncProfile();
  }

  @Delete('connection')
  disconnect() {
    return this.service.disconnect();
  }

  // ── Video ────────────────────────────────────────────────
  /** Video đã cache + tổng chỉ số — màn mở ra là có ngay, không đợi gọi TikTok. */
  @Get('videos')
  videos(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.service.listVideos(Number(limit) || 30, Number(offset) || 0);
  }

  /** Kéo video mới nhất từ TikTok về. */
  @Post('videos/sync')
  syncVideos(@Body() body: { max?: number }) {
    return this.service.syncVideos(Number(body?.max) || 40);
  }

  // ── Đăng video ───────────────────────────────────────────
  /** Thông tin người đăng do TikTok trả về (mức riêng tư được phép, giới hạn độ dài). */
  @Get('creator-info')
  creatorInfo() {
    return this.publishes.creatorInfo();
  }

  @Get('publishes')
  listPublishes(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.publishes.list(Number(limit) || 50, Number(offset) || 0);
  }

  /** Lưu nháp / hẹn giờ / đăng ngay tuỳ `publishNow` + `scheduledAt`. */
  @Post('publishes')
  savePublish(
    @Body()
    body: {
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
    @Req() req: Request & { user?: { email?: string } },
  ) {
    return this.publishes.save(body ?? {}, req.user?.email);
  }

  @Post('publishes/:id/publish')
  publish(@Param('id') id: string) {
    return this.publishes.publish(id);
  }

  /** Hỏi lại TikTok kết quả của bài đang xử lý. */
  @Post('publishes/:id/refresh')
  refresh(@Param('id') id: string) {
    return this.publishes.refresh(id);
  }

  @Delete('publishes/:id')
  deletePublish(@Param('id') id: string) {
    return this.publishes.remove(id);
  }
}
