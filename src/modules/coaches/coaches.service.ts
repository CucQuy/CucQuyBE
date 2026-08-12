import { Injectable } from '@nestjs/common';
import { CoachesProc } from './coaches.proc';
import { Coach } from './coaches.types';

/** Service chỉ orchestration + map; mọi call DB qua CoachesProc. */
@Injectable()
export class CoachesService {
  constructor(private readonly proc: CoachesProc) {}

  async fetchCoaches(): Promise<Coach[]> {
    const rows = await this.proc.get();
    return rows[0]?.coaches_get ?? [];
  }

  async saveCoaches(coaches: Coach[]): Promise<Coach[]> {
    const rows = await this.proc.saveAll(coaches ?? []);
    return rows[0]?.coaches_save_all ?? [];
  }
}
