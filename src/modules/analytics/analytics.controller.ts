import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { AnalyticsInsightService } from '../ai/tasks/analytics-insight/analytics-insight.service';

/**
 * Trang Phân tích: số liệu rule-based đã TÁCH sang endpoint theo domain
 * (order/product/customer/commission/revenue `/analytics`). Module này chỉ còn
 * giữ nhận định AI (gộp số liệu FE gửi lên) — chạy khi user bấm nút.
 */
@ApiTags('Phân tích')
@Controller('analytics')
@UseGuards(SsoAuthGuard)
export class AnalyticsController {
  constructor(private readonly insight: AnalyticsInsightService) {}

  /** Nhận định AI — CHỈ gọi khi user bấm nút (tốn credit). Body: { overview }. */
  @Post('insight')
  async insightAi(@Body('overview') overview: unknown) {
    const data = await this.insight.run(overview ?? {});
    return { insight: data };
  }
}
