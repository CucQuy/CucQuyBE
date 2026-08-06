import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser, UserRole } from '../../auth/user.types';
import { ResponseMessage } from '../../common/response-message.decorator';
import { CommissionService } from './commission.service';
import { MarkPaidDto } from './dto/mark-paid.dto';

@ApiTags('Hoa hồng')
@Controller('commission')
@UseGuards(SsoAuthGuard, RolesGuard)
export class CommissionController {
  constructor(private readonly service: CommissionService) {}

  /** Admin: thống kê hoa hồng tất cả CTV. */
  @Get('summaries')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  getSummaries() {
    return this.service.getAllSummaries();
  }

  /** CTV / admin: hoa hồng của chính mình. */
  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    const name = user.displayName || user.email || user.uid;
    return this.service.getMySummary(user.uid, name);
  }

  /** Admin: đánh dấu các đơn đã trả hoa hồng. */
  @Post('mark-paid')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ResponseMessage('Đã đánh dấu đã trả hoa hồng')
  async markPaid(@Body() dto: MarkPaidDto) {
    await this.service.setPaidStatus(dto.orderIds, true);
    return { ok: true, count: dto.orderIds.length };
  }

  /** Admin: đặt lại các đơn về chưa trả. */
  @Post('mark-pending')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ResponseMessage('Đã đặt lại thành chưa trả')
  async markPending(@Body() dto: MarkPaidDto) {
    await this.service.setPaidStatus(dto.orderIds, false);
    return { ok: true, count: dto.orderIds.length };
  }
}
