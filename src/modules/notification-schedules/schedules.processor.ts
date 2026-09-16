import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE_SCHEDULES } from '../../queue/queue.constants';
import { NotificationSchedulesService } from './notification-schedules.service';
import { SocialPostsService } from '../facebook/social-posts.service';
import { TiktokPublishService } from '../tiktok/tiktok-publish.service';

/**
 * Worker cho lịch thông báo. Đăng ký 1 repeatable job 'tick' chạy mỗi phút
 * (jobId cố định → không nhân bản khi restart). Mỗi tick gọi runDue().
 */
@Processor(QUEUE_SCHEDULES)
export class SchedulesProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SchedulesProcessor.name);

  constructor(
    @InjectQueue(QUEUE_SCHEDULES) private readonly queue: Queue,
    private readonly service: NotificationSchedulesService,
    private readonly socialPosts: SocialPostsService,
    private readonly tiktokPublishes: TiktokPublishService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        'tick',
        {},
        {
          repeat: { pattern: '* * * * *' },
          jobId: 'schedule-tick',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log('Đã đăng ký cron lịch thông báo (mỗi phút).');
    } catch (err) {
      this.logger.error(`Đăng ký cron lịch thất bại: ${String(err)}`);
    }
  }

  async process(_job: Job): Promise<void> {
    await this.service.runDue();
    // Dùng chung tick mỗi phút cho bài mạng xã hội đã hẹn giờ (Instagram không có
    // hẹn giờ native); lỗi bên này không được làm hỏng lịch thông báo.
    await this.socialPosts.runScheduled().catch(() => undefined);
    // TikTok cũng không có hẹn giờ, lại còn đăng bất đồng bộ → tick này vừa gửi bài
    // tới giờ, vừa hỏi lại kết quả các bài TikTok đang xử lý.
    await this.tiktokPublishes.runScheduled().catch(() => undefined);
  }
}
