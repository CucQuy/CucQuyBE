import { Injectable } from '@nestjs/common';
import { CalendarProc } from './calendar.proc';
import {
  CalendarEvent,
  CustomEvent,
  CustomEventInput,
  RangeInput,
} from './calendar.types';

/** Orchestration màn Lịch — gộp event + CRUD sự kiện tự thêm. */
@Injectable()
export class CalendarService {
  constructor(private readonly proc: CalendarProc) {}

  async all(input: RangeInput): Promise<CalendarEvent[]> {
    const rows = await this.proc.all(input);
    return rows[0]?.result ?? [];
  }

  async saveCustom(input: CustomEventInput): Promise<CustomEvent> {
    const rows = await this.proc.saveCustom(input);
    return rows[0].result;
  }

  async removeCustom(id: string): Promise<{ ok: boolean; reason?: string }> {
    const rows = await this.proc.removeCustom(id);
    return rows[0].result;
  }
}
