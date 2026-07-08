import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { ResponseMessage } from '../../common/response-message.decorator';
import { BadgesService } from './badges.service';
import { SaveBadgesDto } from './dto/save-badges.dto';

@ApiTags('Badge')
@Controller('badges')
@UseGuards(SsoAuthGuard)
export class BadgesController {
  constructor(private readonly service: BadgesService) {}

  /** Cấu hình badges (order/product/customer rules). */
  @Get()
  fetch() {
    return this.service.fetchBadgesConfiguration();
  }

  /** Lưu lại toàn bộ cấu hình badges. */
  @Put()
  @ResponseMessage('Đã lưu cấu hình badge')
  async save(@Body() dto: SaveBadgesDto) {
    await this.service.saveBadgesConfiguration(
      dto.orderBadges,
      dto.productBadges,
      dto.customerRules,
      dto.updatedBy,
    );
    return { ok: true };
  }
}
