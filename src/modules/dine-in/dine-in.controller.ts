import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { DineInService } from './dine-in.service';
import { DineInTableInput } from './dine-in.types';

/** Order theo bàn (dine-in): quản lý bàn trên sơ đồ + đóng bàn. */
@ApiTags('Order theo bàn')
@Controller('dine-in')
@UseGuards(SsoAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class DineInController {
  constructor(private readonly service: DineInService) {}

  /** Danh sách bàn (kèm đơn đang mở) — cho map + bảng danh sách. */
  @Get('tables')
  listTables() {
    return this.service.listTables();
  }

  /** Tạo bàn mới. */
  @Post('tables')
  createTable(@Body() body: DineInTableInput) {
    return this.service.upsertTable(body);
  }

  /** Sửa bàn (đổi tên / vị trí kéo-thả / số ghế). */
  @Put('tables/:id')
  updateTable(@Param('id') id: string, @Body() body: DineInTableInput) {
    return this.service.upsertTable({ ...body, id });
  }

  /** Xoá bàn (soft). */
  @Delete('tables/:id')
  removeTable(@Param('id') id: string) {
    return this.service.deleteTable(id);
  }

  /** Đóng bàn của 1 đơn (set giờ ra). */
  @Post('orders/:orderId/checkout')
  checkout(@Param('orderId') orderId: string) {
    return this.service.checkout(orderId);
  }
}
