import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Tầng dữ liệu cho trang Phân tích — gọi stored function analytics_overview(). */
@Injectable()
export class AnalyticsProc {
  constructor(private readonly db: DbService) {}

  async overview(): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> }[]>`
      SELECT analytics_overview() AS data`;
    return row?.data ?? {};
  }
}
