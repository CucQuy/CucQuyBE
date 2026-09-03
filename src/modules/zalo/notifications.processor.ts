import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { QUEUE_NOTIFICATIONS } from '../../queue/queue.constants';
import { ZaloService, ZaloSendPayload } from './zalo.service';

/**
 * Worker gửi Zalo. Bridge Abit có anti-abuse (gửi dồn → chặn IP, cổng 443 refuse),
 * nên worker tự giới hạn 5 job / 10s và KHÔNG retry những lỗi retry vô nghĩa
 * (bridge đã nhận request nhưng trả status error: sai ID nhóm, số gửi chưa kết nối,
 * quá giới hạn tìm SĐT/giờ...). Chỉ lỗi mạng/kết nối mới đáng thử lại.
 */
@Processor(QUEUE_NOTIFICATIONS, { limiter: { max: 5, duration: 10000 } })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly zalo: ZaloService) {
    super();
  }

  async process(job: Job<ZaloSendPayload>): Promise<void> {
    try {
      await this.zalo.deliver(job.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Lỗi do bridge TRẢ VỀ (đã tới được server) → retry chỉ đốt thêm quota.
      if (/ failed \[/.test(msg) || /configuration is missing/i.test(msg)) {
        throw new UnrecoverableError(msg);
      }
      throw err;
    }
    this.logger.log(`Đã gửi Zalo (job ${job.id})`);
  }
}
