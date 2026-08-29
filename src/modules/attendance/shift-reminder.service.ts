import { Injectable, Logger } from '@nestjs/common';
import { AttendanceProc } from './attendance.proc';
import { ZaloService } from '../zalo/zalo.service';

/** Ngày (VN) theo dạng dd/mm cho nhãn tuần. */
function vnDate(offsetDays: number): { label: string } {
  const now = new Date();
  // Chuyển sang giờ VN (UTC+7) rồi cộng offset ngày.
  const vn = new Date(now.getTime() + 7 * 3600 * 1000 + offsetDays * 86400 * 1000);
  const label = `${vn.getUTCDate()}/${vn.getUTCMonth() + 1}`;
  return { label };
}

/** Thứ 2 → CN của TUẦN SAU (VN), trả nhãn "dd/mm–dd/mm". */
function nextWeekLabel(): string {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  const dow = vn.getUTCDay() === 0 ? 7 : vn.getUTCDay(); // 1=T2..7=CN
  const toNextMonday = 8 - dow; // số ngày tới thứ 2 tuần sau
  const mon = vnDate(toNextMonday).label;
  const sun = vnDate(toNextMonday + 6).label;
  return `${mon}–${sun}`;
}

/**
 * Nhắc NV đăng ký ca cho tuần sau qua Zalo cá nhân (Thứ Bảy hằng tuần).
 * Gửi tới TỪNG NV active có SĐT; kèm link mở trang đăng ký (PWA nếu đã cài).
 */
@Injectable()
export class ShiftReminderService {
  private readonly logger = new Logger(ShiftReminderService.name);

  constructor(
    private readonly proc: AttendanceProc,
    private readonly zalo: ZaloService,
  ) {}

  private link(): string {
    const base = (process.env.FE_SITE_URL || 'https://admin.cucquy.site').replace(/\/+$/, '');
    return `${base}/attendance/register`;
  }

  /** Gửi nhắc cho toàn bộ NV active có SĐT. Trả số lượng đã bắn. */
  async sendWeeklyReminders(): Promise<{ sent: number; skipped: number }> {
    const rows = await this.proc.reminderRecipients();
    const recipients = rows[0]?.result ?? [];
    const week = nextWeekLabel();
    const link = this.link();
    let sent = 0;
    let skipped = 0;

    for (const r of recipients) {
      const phone = String(r?.phone ?? '').trim();
      if (!phone) {
        skipped += 1;
        continue;
      }
      const message =
        `Chào ${r.name}! 🗓️\n` +
        `Nhắc bạn đăng ký ca làm cho TUẦN SAU (${week}).\n` +
        `Vào đăng ký rồi bấm "Chốt đăng ký" — sau khi chốt sẽ không sửa được nữa:\n` +
        `${link}`;
      try {
        await this.zalo.send({ message, toNumbers: [phone] });
        sent += 1;
      } catch (err) {
        skipped += 1;
        this.logger.warn(`Gửi nhắc ca cho ${r.name} (${phone}) lỗi: ${String(err)}`);
      }
    }
    this.logger.log(`Nhắc đăng ký ca: gửi ${sent}, bỏ qua ${skipped}.`);
    return { sent, skipped };
  }
}
