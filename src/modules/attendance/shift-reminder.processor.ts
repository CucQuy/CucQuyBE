import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE_SHIFT_REMINDERS } from '../../queue/queue.constants';
import { ShiftReminderService } from './shift-reminder.service';

/**
 * Cron nhắc đăng ký ca: repeatable job chạy Thứ Bảy 9h (giờ VN), jobId cố định
 * (không nhân bản khi restart). Mỗi lần chạy → gửi nhắc Zalo cá nhân cho NV.
 */
@Processor(QUEUE_SHIFT_REMINDERS)
export class ShiftReminderProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ShiftReminderProcessor.name);

  constructor(
    @InjectQueue(QUEUE_SHIFT_REMINDERS) private readonly queue: Queue,
    private readonly service: ShiftReminderService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        'weekly-reminder',
        {},
        {
          repeat: { pattern: '0 9 * * 6', tz: 'Asia/Ho_Chi_Minh' }, // T7 9h VN
          jobId: 'shift-register-reminder',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log('Đã đăng ký cron nhắc đăng ký ca (Thứ Bảy 9h VN).');
    } catch (err) {
      this.logger.error(`Đăng ký cron nhắc ca thất bại: ${String(err)}`);
    }
  }

  async process(_job: Job): Promise<void> {
    await this.service.sendWeeklyReminders();
  }
}
