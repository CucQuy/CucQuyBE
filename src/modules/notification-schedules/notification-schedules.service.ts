import { Injectable, Logger } from '@nestjs/common';
import { NotificationScheduleProc } from './notification-schedules.proc';
import { ZaloService } from '../zalo/zalo.service';
import { NotificationSchedule, ScheduleInput } from './notification-schedules.types';

/** yyyy-mm-dd + n ngày (theo lịch, xử lý chuỗi ISO). */
const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

@Injectable()
export class NotificationSchedulesService {
  private readonly logger = new Logger(NotificationSchedulesService.name);

  constructor(
    private readonly proc: NotificationScheduleProc,
    private readonly zalo: ZaloService,
  ) {}

  async list(): Promise<NotificationSchedule[]> {
    const [row] = await this.proc.list();
    return row?.result ?? [];
  }

  async create(input: ScheduleInput): Promise<{ id: string }> {
    const [row] = await this.proc.create(input);
    return row.result;
  }

  async update(id: string, input: ScheduleInput): Promise<{ id: string }> {
    const [row] = await this.proc.update(id, input);
    return row.result;
  }

  async remove(id: string): Promise<void> {
    await this.proc.remove(id);
  }

  /** Soạn nội dung cho 1 loại lịch (today = yyyy-mm-dd VN). */
  private async compose(type: string, today: string): Promise<string | null> {
    if (type === 'daily_summary') {
      const [r] = await this.proc.composeDailySummary(today);
      return r?.msg ?? null;
    }
    if (type === 'production_tomorrow') {
      const [r] = await this.proc.composeProduction(addDays(today, 1));
      return r?.msg ?? null;
    }
    return null;
  }

  /**
   * Cron gọi mỗi phút: tìm lịch đến hạn → soạn → gửi Zalo → đánh dấu đã chạy.
   * Zalo.send tự ghi nhật ký (sent/failed). Không throw ra ngoài worker.
   */
  async runDue(): Promise<void> {
    let due;
    try {
      const [row] = await this.proc.due();
      due = row?.result ?? [];
    } catch (err) {
      this.logger.error(`Đọc lịch đến hạn thất bại: ${String(err)}`);
      return;
    }
    for (const s of due) {
      try {
        const msg = await this.compose(s.type, s.today);
        if (msg) {
          await this.zalo.send({
            message: msg,
            groupIds: s.targetGroupIds && s.targetGroupIds.length > 0 ? s.targetGroupIds : undefined,
          });
        }
        await this.proc.markRun(s.id, s.today);
        this.logger.log(`Đã chạy lịch ${s.type} (${s.id})`);
      } catch (err) {
        this.logger.error(`Chạy lịch ${s.id} thất bại: ${String(err)}`);
        // vẫn mark để không lặp vô hạn trong ngày; lỗi Zalo đã vào nhật ký + có thể gửi lại.
        try {
          await this.proc.markRun(s.id, s.today);
        } catch {
          /* noop */
        }
      }
    }
  }
}
