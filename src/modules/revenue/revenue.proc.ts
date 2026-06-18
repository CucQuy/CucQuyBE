import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { RevenueReport } from './revenue.types';

/** Hàng raw trả ra từ stored function (jsonb). */
export type RevenueReportRow = { report: RevenueReport };

/**
 * Tầng quản lý stored procedure của domain revenue.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class RevenueProc {
  constructor(private readonly db: DbService) {}

  /** Báo cáo doanh thu trong kỳ — tính toàn bộ ở DB (revenue_report). */
  report(fromISO: string, toISO: string): Promise<RevenueReportRow[]> {
    return this.db.sql<RevenueReportRow[]>`
      SELECT revenue_report(${fromISO}, ${toISO}) AS report`;
  }
}
