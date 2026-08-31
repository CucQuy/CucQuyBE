import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE_PAYROLL_CLOSING } from '../../queue/queue.constants';
import { PayrollClosingService } from './payroll-closing.service';

/** Ngày hiện tại theo giờ VN (UTC+7), trả {y,m,d}. */
function vnToday(): { y: number; m: number; d: number } {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  return { y: vn.getUTCFullYear(), m: vn.getUTCMonth() + 1, d: vn.getUTCDate() };
}

/** Hôm nay (giờ VN) có phải NGÀY CUỐI của tháng không. */
function isLastDayOfMonthVN(): boolean {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const tomorrow = new Date(now.getTime() + 86400 * 1000);
  // Sang ngày mai mà đổi tháng → hôm nay là ngày cuối tháng.
  return tomorrow.getUTCMonth() !== now.getUTCMonth();
}

/**
 * Cron chốt công cuối tháng: repeatable job chạy 20h (giờ VN) các ngày 28–31.
 * Trong process() mới kiểm tra ĐÚNG ngày cuối tháng mới thực thi (cron không có
 * token "ngày cuối tháng"). jobId cố định để không nhân bản khi restart.
 */
@Processor(QUEUE_PAYROLL_CLOSING)
export class PayrollClosingProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(PayrollClosingProcessor.name);

  constructor(
    @InjectQueue(QUEUE_PAYROLL_CLOSING) private readonly queue: Queue,
    private readonly service: PayrollClosingService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        'month-closing',
        {},
        {
          repeat: { pattern: '0 20 28-31 * *', tz: 'Asia/Ho_Chi_Minh' }, // 20h VN, ngày 28-31
          jobId: 'payroll-month-closing',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log('Đã đăng ký cron chốt công cuối tháng (20h VN, ngày 28–31).');
    } catch (err) {
      this.logger.error(`Đăng ký cron chốt công thất bại: ${String(err)}`);
    }
  }

  async process(_job: Job): Promise<void> {
    if (!isLastDayOfMonthVN()) {
      const t = vnToday();
      this.logger.debug(`Bỏ qua chốt công: ${t.d}/${t.m} chưa phải ngày cuối tháng.`);
      return;
    }
    await this.service.runClosing();
  }
}
