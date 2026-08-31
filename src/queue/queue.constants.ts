/** Tên các queue BullMQ. */
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_WEBHOOKS = 'webhooks';
/** Queue cho cron lịch thông báo (repeatable tick mỗi phút). */
export const QUEUE_SCHEDULES = 'schedules';
/** Queue cho cron nhắc đăng ký ca hằng tuần (repeatable Thứ Bảy 9h VN). */
export const QUEUE_SHIFT_REMINDERS = 'shift_reminders';
/** Queue cho cron chốt công cuối tháng (repeatable 20h các ngày 28-31, guard ngày cuối). */
export const QUEUE_PAYROLL_CLOSING = 'payroll_closing';

/** Connection cho BullMQ, parse từ REDIS_URL (mặc định localhost:6379). */
export function bullConnection(): { host: string; port: number } {
  const raw = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    const u = new URL(raw);
    return { host: u.hostname, port: Number(u.port) || 6379 };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}
