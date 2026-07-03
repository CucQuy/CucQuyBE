/** Tên các queue BullMQ. */
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_WEBHOOKS = 'webhooks';
/** Queue cho cron lịch thông báo (repeatable tick mỗi phút). */
export const QUEUE_SCHEDULES = 'schedules';

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
