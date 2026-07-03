import { Injectable, Logger } from '@nestjs/common';
import { NotificationProc } from './notifications.proc';
import {
  Notification,
  NotificationLogInput,
  NotificationListResult,
} from './notifications.types';

/**
 * Logic ở stored function notification_* — service orchestration.
 * `log()` fire-and-forget: KHÔNG throw ra ngoài (lỗi ghi log không được làm hỏng
 * luồng gửi Zalo / emit socket).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly proc: NotificationProc) {}

  /** Ghi 1 thông báo, trả id (hoặc null nếu lỗi). Không throw. */
  async log(input: NotificationLogInput): Promise<string | null> {
    try {
      const [row] = await this.proc.log(input);
      return row?.result?.id ?? null;
    } catch (err) {
      this.logger.error(`Ghi notification thất bại: ${String(err)}`);
      return null;
    }
  }

  async list(params: {
    kind?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<NotificationListResult> {
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));
    const page = Math.max(1, params.page ?? 1);
    const [row] = await this.proc.list({
      kind: params.kind ?? null,
      status: params.status ?? null,
      from: params.from ?? null,
      to: params.to ?? null,
      limit,
      offset: (page - 1) * limit,
    });
    return row?.result ?? { items: [], hasMore: false };
  }

  async inbox(limit = 20): Promise<Notification[]> {
    const [row] = await this.proc.inbox(Math.min(100, Math.max(1, limit)));
    return (row?.result ?? []) as Notification[];
  }

  async unreadCount(): Promise<number> {
    const [row] = await this.proc.unreadCount();
    return Number(row?.count ?? 0);
  }

  async markRead(id: string): Promise<void> {
    await this.proc.markRead(id);
  }

  async markAllRead(): Promise<number> {
    const [row] = await this.proc.markAllRead();
    return Number(row?.count ?? 0);
  }

  /** Lấy payload gốc (để gửi lại). null nếu không có. */
  async getPayload(id: string): Promise<unknown | null> {
    const [row] = await this.proc.payload(id);
    return row?.payload ?? null;
  }

  async setStatus(id: string, status: string, error: string | null = null): Promise<void> {
    await this.proc.setStatus(id, status, error);
  }
}
