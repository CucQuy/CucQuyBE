import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { WageRate, WageRateInput } from './wages.types';

/** Tầng gọi stored function wage_rate_* (raw SQL). */
@Injectable()
export class WagesProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<Array<{ result: WageRate[] }>> {
    return this.db.sql<Array<{ result: WageRate[] }>>`
      SELECT wage_rate_list() AS result`;
  }

  add(input: WageRateInput): Promise<Array<{ result: WageRate }>> {
    return this.db.sql<Array<{ result: WageRate }>>`
      SELECT wage_rate_add(${this.db.json(input)}::jsonb) AS result`;
  }

  remove(id: string): Promise<Array<{ result: { ok: boolean; reason?: string } }>> {
    return this.db.sql<Array<{ result: { ok: boolean; reason?: string } }>>`
      SELECT wage_rate_remove(${id}) AS result`;
  }
}
