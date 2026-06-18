import { Module } from '@nestjs/common';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { RevenueProc } from './revenue.proc';

/**
 * Báo cáo doanh thu (P&L). Toàn bộ logic tổng hợp đã chuyển xuống stored
 * function app.revenue_* — RevenueProc gọi DbService (global), service chỉ
 * orchestration + cache Redis (global), nên không cần import service domain nào khác.
 */
@Module({
  controllers: [RevenueController],
  providers: [RevenueService, RevenueProc],
})
export class RevenueModule {}
