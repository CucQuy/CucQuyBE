import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { CalendarService } from './calendar.service';
import { CustomEventInput } from './calendar.types';

/** Màn Lịch — gộp event nhiều nguồn + sự kiện tự thêm. Chỉ super_admin/admin. */
@ApiTags('Lịch')
@Controller('calendar')
@UseGuards(SsoAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  /** Mọi event trong khoảng ngày (đơn + ca + tự thêm + chấm công). */
  @Get()
  all(@Query('from') from: string, @Query('to') to: string) {
    return this.service.all({ from, to });
  }

  /** Tạo/sửa sự kiện tự thêm. */
  @Post('custom')
  saveCustom(@Body() body: CustomEventInput) {
    return this.service.saveCustom(body);
  }

  /** Xoá sự kiện tự thêm. */
  @Delete('custom/:id')
  removeCustom(@Param('id') id: string) {
    return this.service.removeCustom(id);
  }
}
