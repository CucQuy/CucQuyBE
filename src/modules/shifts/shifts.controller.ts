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
import { UserRole, AuthUser } from '../../auth/user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ShiftsService } from './shifts.service';
import { SetDayInput, WorkShiftSaveItem } from './shifts.types';

/** Ca làm + lịch phân ca — chỉ super_admin/admin. */
@ApiTags('Ca làm')
@Controller('shifts')
@UseGuards(SsoAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class ShiftsController {
  constructor(private readonly service: ShiftsService) {}

  /** Danh sách ca định nghĩa (giờ + thứ trong tuần). */
  @Get()
  listShifts() {
    return this.service.listShifts();
  }

  /** Lưu cài đặt ca (giờ + thứ trong tuần + bật/tắt). */
  @Put()
  saveShifts(@Body() body: WorkShiftSaveItem[]) {
    return this.service.saveShifts(body);
  }

  /** Phân ca trong khoảng ngày (cho calendar). */
  @Get('assignments')
  range(@Query('from') from: string, @Query('to') to: string) {
    return this.service.range({ from, to });
  }

  /** Đặt trọn danh sách NV cho 1 (ngày, ca). Ghi lịch sử kèm email người sửa. */
  @Put('assignments/day')
  setDay(@CurrentUser() user: AuthUser, @Body() body: SetDayInput) {
    return this.service.setDay({ ...body, changedBy: user?.email });
  }

  /** Xoá 1 phân ca theo id. */
  @Delete('assignments/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(id, user?.email);
  }

  /**
   * Lịch sử thay đổi đăng ký ca — NV tick nhầm rồi admin sửa thì còn dấu vết.
   * Lọc theo nhân viên / khoảng ngày làm việc.
   */
  @Get('assignments/logs')
  logs(
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.logs({ employeeId, from, to, limit: Number(limit) || 100 });
  }
}
