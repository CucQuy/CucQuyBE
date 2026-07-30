import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { AnalyticsProc } from './analytics.proc';
import { AnalyticsInsightService } from '../ai/tasks/analytics-insight/analytics-insight.service';

@ApiTags('Phân tích')
@Controller('analytics')
@UseGuards(SsoAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly proc: AnalyticsProc,
    private readonly insight: AnalyticsInsightService,
  ) {}

  /** Số liệu tổng hợp cho trang Phân tích (rule-based, không AI). */
  @Get('overview')
  overview() {
    return this.proc.overview();
  }

  /** Nhận định AI — CHỈ gọi khi user bấm nút (tốn credit). Body: { overview }. */
  @Post('insight')
  async insightAi(@Body('overview') overview: unknown) {
    const data = await this.insight.run(overview ?? {});
    return { insight: data };
  }
}
