import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { ShiftsService } from './shifts.service';
import { SetDayInput } from './shifts.types';

/** Ca làm + lịch phân ca — chỉ super_admin/admin. */
@ApiTags('Ca làm')
@Controller('shifts')
@UseGuards(SsoAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class ShiftsController {
  constructor(private readonly service: ShiftsService) {}

  /** Danh sách ca định nghĩa (3 ca cố định). */
  @Get()
  listShifts() {
    return this.service.listShifts();
  }

  /** Phân ca trong khoảng ngày (cho calendar). */
  @Get('assignments')
  range(@Query('from') from: string, @Query('to') to: string) {
    return this.service.range({ from, to });
  }

  /** Đặt trọn danh sách NV cho 1 (ngày, ca). */
  @Put('assignments/day')
  setDay(@Body() body: SetDayInput) {
    return this.service.setDay(body);
  }

  /** Xoá 1 phân ca theo id. */
  @Delete('assignments/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
