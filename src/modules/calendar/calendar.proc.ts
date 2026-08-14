import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  CalendarEvent,
  CustomEvent,
  CustomEventInput,
  RangeInput,
} from './calendar.types';

/** Tầng gọi stored function calendar_* (raw SQL). */
@Injectable()
export class CalendarProc {
  constructor(private readonly db: DbService) {}

  all(input: RangeInput): Promise<Array<{ result: CalendarEvent[] }>> {
    return this.db.sql<Array<{ result: CalendarEvent[] }>>`
      SELECT calendar_events_all(${this.db.json(input)}::jsonb) AS result`;
  }

  saveCustom(input: CustomEventInput): Promise<Array<{ result: CustomEvent }>> {
    return this.db.sql<Array<{ result: CustomEvent }>>`
      SELECT calendar_event_save(${this.db.json(input)}::jsonb) AS result`;
  }

  removeCustom(
    id: string,
  ): Promise<Array<{ result: { ok: boolean; reason?: string } }>> {
    return this.db.sql<Array<{ result: { ok: boolean; reason?: string } }>>`
      SELECT calendar_event_remove(${id}) AS result`;
  }
}
