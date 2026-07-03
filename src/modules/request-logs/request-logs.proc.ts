import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { GeoInfo } from './request-logs.service';

/** Dòng thô từ bảng request_logs (snake_case). */
export type RequestLogRow = {
  id: string;
  method: string | null;
  path: string | null;
  query: string | null;
  status_code: number | null;
  duration_ms: number | null;
  response_size: number | null;
  ip: string | null;
  geo: GeoInfo | null;
  uid: string | null;
  email: string | null;
  role: string | null;
  user_agent: string | null;
  referer: string | null;
  body: string | null;
  timestamp: Date | string | null;
  expire_at: Date | string | null;
};

/**
 * Tầng quản lý stored procedure của domain request-logs.
 * Chỉ ở đây mới gọi request_log_* — service import class này để dùng.
 */
@Injectable()
export class RequestLogProc {
  constructor(private readonly db: DbService) {}

  insert(entry: unknown, retentionDays: number): Promise<Array<{ '?column?': number }>> {
    return this.db.sql<Array<{ '?column?': number }>>`
      SELECT 1 FROM request_log_insert(
        ${this.db.json(entry)}::jsonb, ${retentionDays}
      )`;
  }

  list(p: {
    from: string | null;
    to: string | null;
    method: string | null;
    status: number | null;
    uid: string | null;
    email: string | null;
    ip: string | null;
    page: number;
    limit: number;
  }): Promise<RequestLogRow[]> {
    return this.db.sql<RequestLogRow[]>`
      SELECT * FROM request_log_list(
        ${p.from},
        ${p.to},
        ${p.method},
        ${p.status},
        ${p.uid},
        ${p.email},
        ${p.ip},
        ${p.page},
        ${p.limit}
      )`;
  }

  stats(
    from: string | null,
    to: string | null,
    scanCap: number,
    errorsOnly: boolean,
  ): Promise<Array<{ stats: unknown }>> {
    return this.db.sql<Array<{ stats: unknown }>>`
      SELECT request_log_stats(
        ${from},
        ${to},
        ${scanCap},
        ${errorsOnly}
      ) AS stats`;
  }

  timeseries(
    from: string | null,
    to: string | null,
    bucket: 'hour' | 'day',
    errorsOnly: boolean,
  ): Promise<Array<{ series: unknown }>> {
    return this.db.sql<Array<{ series: unknown }>>`
      SELECT request_log_timeseries(
        ${from},
        ${to},
        ${bucket},
        ${errorsOnly}
      ) AS series`;
  }

  errorGroups(
    from: string | null,
    to: string | null,
    limit: number,
  ): Promise<Array<{ groups: unknown }>> {
    return this.db.sql<Array<{ groups: unknown }>>`
      SELECT request_log_error_groups(
        ${from},
        ${to},
        ${limit}
      ) AS groups`;
  }

  purgeExpired(): Promise<Array<{ count: string | number }>> {
    return this.db.sql<Array<{ count: string | number }>>`
      SELECT request_log_purge_expired() AS count`;
  }
}
