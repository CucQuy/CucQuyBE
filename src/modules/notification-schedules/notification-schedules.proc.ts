import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { NotificationSchedule, ScheduleInput, DueSchedule } from './notification-schedules.types';

/** Tầng gọi stored function notification_schedule_* + compose. */
@Injectable()
export class NotificationScheduleProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<Array<{ result: NotificationSchedule[] }>> {
    return this.db.sql<Array<{ result: NotificationSchedule[] }>>`
      SELECT notification_schedule_list() AS result`;
  }

  create(input: ScheduleInput): Promise<Array<{ result: { id: string } }>> {
    return this.db.sql<Array<{ result: { id: string } }>>`
      SELECT notification_schedule_create(${this.db.json(input)}::jsonb) AS result`;
  }

  update(id: string, input: ScheduleInput): Promise<Array<{ result: { id: string } }>> {
    return this.db.sql<Array<{ result: { id: string } }>>`
      SELECT notification_schedule_update(${id}, ${this.db.json(input)}::jsonb) AS result`;
  }

  remove(id: string): Promise<unknown> {
    return this.db.sql`SELECT notification_schedule_delete(${id})`;
  }

  due(): Promise<Array<{ result: DueSchedule[] }>> {
    return this.db.sql<Array<{ result: DueSchedule[] }>>`
      SELECT notification_schedule_due() AS result`;
  }

  markRun(id: string, day: string): Promise<unknown> {
    return this.db.sql`SELECT notification_schedule_mark_run(${id}, ${day})`;
  }

  composeDailySummary(date: string): Promise<Array<{ msg: string | null }>> {
    return this.db.sql<Array<{ msg: string | null }>>`
      SELECT notification_compose_daily_summary(${date}) AS msg`;
  }

  composeProduction(date: string): Promise<Array<{ msg: string | null }>> {
    return this.db.sql<Array<{ msg: string | null }>>`
      SELECT notification_compose_production(${date}) AS msg`;
  }
}
