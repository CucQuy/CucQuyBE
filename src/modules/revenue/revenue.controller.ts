import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RevenueService } from './revenue.service';

@ApiTags('Báo cáo doanh thu')
@Controller('revenue')
@UseGuards(SsoAuthGuard)
export class RevenueController {
  constructor(private readonly service: RevenueService) {}

  /** GET /revenue/report?from=<ISO>&to=<ISO> → báo cáo P&L trong kỳ. */
  @Get('report')
  getReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getReport(from ?? '', to ?? '');
  }

}
