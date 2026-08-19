import { Body, Controller, Logger, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Response } from 'express';
import { Public } from '../../auth/roles.decorator';
import { IpThrottlerGuard } from '../../common/ip-throttler.guard';
import { WebhooksService } from './webhooks.service';
import { QUEUE_WEBHOOKS } from '../../queue/queue.constants';

/**
 * Webhook PUBLIC (SePay gọi tới, KHÔNG có token đăng nhập).
 * Dùng @Res() để trả ĐÚNG format gốc (bypass envelope toàn cục) — nhà cung
 * cấp webhook kỳ vọng body riêng, không phải {data,message,...}.
 *
 * SePay: enqueue vào BullMQ rồi trả 200 NGAY (nhà cung cấp chỉ cần 200 nhanh),
 * xử lý nền + retry, idempotent theo sepayId. Queue lỗi → xử lý đồng bộ luôn
 * để không mất webhook.
 */
@ApiTags('Webhook')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly service: WebhooksService,
    @InjectQueue(QUEUE_WEBHOOKS) private readonly queue: Queue,
  ) {}

  // Webhook SePay: 60 lần/phút/IP (SePay thực tế không vượt; chặn flood giả webhook).
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UseGuards(IpThrottlerGuard)
  @Post('sepay')
  async sepay(@Body() body: any, @Res() res: Response) {
    try {
      await this.queue.add('sepay', body);
      res.status(200).json({ success: true, queued: true });
    } catch (err) {
      // Queue/Redis lỗi → xử lý đồng bộ để không mất giao dịch.
      this.logger.warn(`Enqueue webhook sepay thất bại, xử lý đồng bộ: ${String(err)}`);
      try {
        const { status, payload } = await this.service.handleSepay(body);
        res.status(status).json(payload);
      } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'error' });
      }
    }
  }

}
