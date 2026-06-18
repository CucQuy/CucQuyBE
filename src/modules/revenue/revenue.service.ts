import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { RevenueProc } from './revenue.proc';
import { RevenueReport } from './revenue.types';

/** TTL cache báo cáo doanh thu (giây). */
const REPORT_TTL = 120;

/**
 * Báo cáo doanh thu (P&L). Toàn bộ logic tổng hợp nằm ở stored function
 * app.revenue_report(p_from, p_to) — service chỉ gọi (qua RevenueProc) + cache.
 *
 * Lưu ý: chi phí khác (expenses) hiện chưa có bảng Postgres (vẫn ở Firestore),
 * nên totalExpenses do DB trả về = 0. Khi có bảng expenses, bổ sung trong
 * migrations/functions/revenue.sql, service KHÔNG cần đổi.
 */
@Injectable()
export class RevenueService {
  constructor(
    private readonly proc: RevenueProc,
    private readonly redis: RedisService,
  ) {}

  /** Báo cáo doanh thu trong kỳ — tính toàn bộ ở DB (app.revenue_report). */
  async getReport(fromISO: string, toISO: string): Promise<RevenueReport> {
    // Report nặng (gộp nhiều bảng + tính) → cache TTL ngắn theo kỳ. Dữ liệu
    // đổi sẽ phản ánh chậm nhất sau REPORT_TTL giây (chấp nhận được cho báo cáo).
    const cacheKey = `report:revenue:${fromISO}:${toISO}`;
    const cached = await this.redis.get<RevenueReport>(cacheKey);
    if (cached) return cached;

    const rows = await this.proc.report(fromISO, toISO);
    const report = rows[0].report;

    await this.redis.set(cacheKey, report, REPORT_TTL);
    return report;
  }
}
