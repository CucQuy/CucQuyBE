import { Injectable } from '@nestjs/common';
import { ShiftsProc } from './shifts.proc';
import {
  RangeInput,
  SetDayInput,
  ShiftAssignment,
  WorkShift,
  WorkShiftSaveItem,
} from './shifts.types';

/** Orchestration ca làm — danh sách ca + phân ca theo ngày (lịch). */
@Injectable()
export class ShiftsService {
  constructor(private readonly proc: ShiftsProc) {}

  async listShifts(): Promise<WorkShift[]> {
    const rows = await this.proc.listShifts();
    return rows[0]?.result ?? [];
  }

  async saveShifts(items: WorkShiftSaveItem[]): Promise<WorkShift[]> {
    const rows = await this.proc.saveShifts(items);
    return rows[0]?.result ?? [];
  }

  async range(input: RangeInput): Promise<ShiftAssignment[]> {
    const rows = await this.proc.range(input);
    return rows[0]?.result ?? [];
  }

  async setDay(input: SetDayInput): Promise<ShiftAssignment[]> {
    const rows = await this.proc.setDay(input);
    return rows[0]?.result ?? [];
  }

  async remove(id: string): Promise<{ ok: boolean; reason?: string }> {
    const rows = await this.proc.remove(id);
    return rows[0].result;
  }
}
