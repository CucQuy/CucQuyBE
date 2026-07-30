import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsProc } from './analytics.proc';
import { AiModule } from '../ai/ai.module';

/** Trang Phân tích: số liệu tổng hợp (proc) + nhận định AI (AiModule, chỉ khi bấm nút). */
@Module({
  imports: [AiModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsProc],
})
export class AnalyticsModule {}
