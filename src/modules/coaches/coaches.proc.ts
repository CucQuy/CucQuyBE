import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { Coach } from './coaches.types';

/**
 * Tầng quản lý stored procedure của domain coaches.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class CoachesProc {
  constructor(private readonly db: DbService) {}

  get(): Promise<{ coaches_get: Coach[] }[]> {
    return this.db.sql<{ coaches_get: Coach[] }[]>`
      SELECT coaches_get() AS coaches_get`;
  }

  saveAll(payload: unknown): Promise<{ coaches_save_all: Coach[] }[]> {
    return this.db.sql<{ coaches_save_all: Coach[] }[]>`
      SELECT coaches_save_all(${this.db.json(payload ?? [])}::jsonb) AS coaches_save_all`;
  }
}
