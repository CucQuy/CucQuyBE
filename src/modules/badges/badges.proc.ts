import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { BadgesConfiguration } from './badges.types';

/**
 * Tầng quản lý stored procedure của domain badges.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class BadgesProc {
  constructor(private readonly db: DbService) {}

  get(): Promise<{ badges_get: BadgesConfiguration }[]> {
    return this.db.sql<{ badges_get: BadgesConfiguration }[]>`
      SELECT badges_get() AS badges_get`;
  }

  saveAll(payload: unknown) {
    return this.db.sql`
      SELECT badges_save_all(${this.db.json(payload)}::jsonb)`;
  }
}
