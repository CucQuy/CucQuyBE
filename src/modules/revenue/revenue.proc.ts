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

  /** Phân tích P&L theo tháng trong kỳ (p_from/p_to NULL = toàn bộ). */
  async analytics(from: string | null, to: string | null): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> }[]>`
      SELECT revenue_analytics(${from}::date, ${to}::date) AS data`;
    return row?.data ?? {};
  }
}
