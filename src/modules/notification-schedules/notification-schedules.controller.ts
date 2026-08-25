import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { NotificationSchedulesService } from './notification-schedules.service';
import { ScheduleInput, ScheduleType } from './notification-schedules.types';

/** Lịch tự động gửi thông báo — chỉ super_admin/admin. */
@ApiTags('Lịch thông báo')
@Controller('notification-schedules')
@UseGuards(SsoAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class NotificationSchedulesController {
  constructor(private readonly service: NotificationSchedulesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: ScheduleInput) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ScheduleInput) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { id };
  }

  /** Gửi NGAY 1 loại thông báo qua Zalo (nhóm mặc định). Dùng cho nút thủ công.
   *  fromDate/days (tuỳ chọn) chỉ áp dụng cho delivery_by_day. */
  @Post('send-now')
  sendNow(@Body() body: { type: ScheduleType; fromDate?: string; days?: number }) {
    return this.service.sendNow(body.type, { fromDate: body.fromDate, days: body.days });
  }
}
