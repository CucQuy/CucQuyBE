import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import { FacebookService } from './facebook.service';

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
  constructor(private readonly service: FacebookService) {}

  /** Danh sách khách đã inbox page. filter: window (còn 24h) | optin | '' (tất cả). */
  @Get('contacts')
  contacts(
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listContacts(
      String(filter ?? ''),
      Number(limit) || 100,
      Number(offset) || 0,
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
