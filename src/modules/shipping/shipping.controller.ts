import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { ShippingService } from './shipping.service';

@ApiTags('Vận chuyển')
@Controller('shipping')
@UseGuards(SsoAuthGuard)
export class ShippingController {
  constructor(private readonly service: ShippingService) {}

  /** Chỉ số theo đơn vị vận chuyển (DVVC) trong kỳ. ?from&to (YYYY-MM-DD, rỗng = toàn bộ). */
  @Get('analytics')
  analytics(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.analytics(from, to);
  }
}
