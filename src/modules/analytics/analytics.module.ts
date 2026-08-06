import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AiModule } from '../ai/ai.module';

/** Trang Phân tích: nhận định AI (AiModule, chỉ khi bấm nút). Số liệu rule-based
 *  đã tách sang endpoint theo domain (order/product/customer/commission/revenue). */
@Module({
  imports: [AiModule],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
