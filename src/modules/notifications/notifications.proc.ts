import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { NotificationLogInput, NotificationListResult } from './notifications.types';

/** Tầng gọi stored function notification_* — service dùng lại. */
@Injectable()
export class NotificationProc {
  constructor(private readonly db: DbService) {}

  log(input: NotificationLogInput): Promise<Array<{ result: { id: string } }>> {
    return this.db.sql<Array<{ result: { id: string } }>>`
      SELECT notification_log(${this.db.json(input)}::jsonb) AS result`;
  }

  logLogin(uid: string, name: string): Promise<unknown> {
    return this.db.sql`SELECT notification_log_login(${uid}, ${name})`;
  }

  list(p: {
    kind: string | null;
    status: string | null;
    from: string | null;
    to: string | null;
    limit: number;
    offset: number;
  }): Promise<Array<{ result: NotificationListResult }>> {
    return this.db.sql<Array<{ result: NotificationListResult }>>`
      SELECT notification_list(
        ${p.kind}, ${p.status}, ${p.from}, ${p.to}, ${p.limit}, ${p.offset}
      ) AS result`;
  }

  inbox(limit: number): Promise<Array<{ result: unknown }>> {
    return this.db.sql<Array<{ result: unknown }>>`
      SELECT notification_inbox(${limit}) AS result`;
  }

  unreadCount(): Promise<Array<{ count: number }>> {
    return this.db.sql<Array<{ count: number }>>`
      SELECT notification_unread_count() AS count`;
  }

  markRead(id: string): Promise<unknown> {
    return this.db.sql`SELECT notification_mark_read(${id})`;
  }

  markAllRead(): Promise<Array<{ count: number }>> {
    return this.db.sql<Array<{ count: number }>>`
      SELECT notification_mark_all_read() AS count`;
  }

  payload(id: string): Promise<Array<{ payload: unknown }>> {
    return this.db.sql<Array<{ payload: unknown }>>`
      SELECT notification_payload(${id}) AS payload`;
  }

  setStatus(id: string, status: string, error: string | null): Promise<unknown> {
    return this.db.sql`SELECT notification_set_status(${id}, ${status}, ${error})`;
  }
}
