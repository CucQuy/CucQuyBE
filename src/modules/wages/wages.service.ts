import { Injectable } from '@nestjs/common';
import { WagesProc } from './wages.proc';
import { WageRate, WageRateInput } from './wages.types';

/** Orchestration mức lương giờ theo vị trí (có lịch sử). */
@Injectable()
export class WagesService {
  constructor(private readonly proc: WagesProc) {}

  async list(): Promise<WageRate[]> {
    const rows = await this.proc.list();
    return rows[0]?.result ?? [];
  }

  async add(input: WageRateInput): Promise<WageRate> {
    const rows = await this.proc.add(input);
    return rows[0].result;
  }

  async update(id: string, input: WageRateInput): Promise<WageRate> {
    const rows = await this.proc.update(id, input);
    return rows[0].result;
  }

  async remove(id: string): Promise<{ ok: boolean; reason?: string }> {
    const rows = await this.proc.remove(id);
    return rows[0].result;
  }
}
