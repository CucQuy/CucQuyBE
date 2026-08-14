import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  RangeInput,
  SetDayInput,
  ShiftAssignment,
  WorkShift,
} from './shifts.types';

/** Tầng gọi stored function work_shift_* / shift_assignment_* (raw SQL). */
@Injectable()
export class ShiftsProc {
  constructor(private readonly db: DbService) {}

  listShifts(): Promise<Array<{ result: WorkShift[] }>> {
    return this.db.sql<Array<{ result: WorkShift[] }>>`
      SELECT work_shift_list() AS result`;
  }

  range(input: RangeInput): Promise<Array<{ result: ShiftAssignment[] }>> {
    return this.db.sql<Array<{ result: ShiftAssignment[] }>>`
      SELECT shift_assignment_range(${this.db.json(input)}::jsonb) AS result`;
  }

  setDay(input: SetDayInput): Promise<Array<{ result: ShiftAssignment[] }>> {
    return this.db.sql<Array<{ result: ShiftAssignment[] }>>`
      SELECT shift_assignment_set_day(${this.db.json(input)}::jsonb) AS result`;
  }

  remove(id: string): Promise<Array<{ result: { ok: boolean; reason?: string } }>> {
    return this.db.sql<Array<{ result: { ok: boolean; reason?: string } }>>`
      SELECT shift_assignment_remove(${id}) AS result`;
  }
}
