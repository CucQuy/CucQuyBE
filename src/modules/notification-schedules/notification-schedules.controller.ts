import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../../auth/firebase-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { NotificationSchedulesService } from './notification-schedules.service';
import { ScheduleInput } from './notification-schedules.types';

/** Lịch tự động gửi thông báo — chỉ super_admin/admin. */
@ApiTags('Lịch thông báo')
@Controller('notification-schedules')
@UseGuards(FirebaseAuthGuard, RolesGuard)
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
}
