import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../../auth/firebase-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { NotificationsService } from './notifications.service';

/** Nhật ký gửi + hộp thư in-app. Admin/super_admin. */
@ApiTags('Thông báo')
@Controller('notifications')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /** Nhật ký gửi (lọc kind/status + thời gian, phân trang). */
  @Get()
  list(
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      kind,
      status,
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Hộp thư in-app (mới nhất) cho chuông navbar. */
  @Get('inbox')
  inbox(@Query('limit') limit?: string) {
    return this.service.inbox(limit ? Number(limit) : 20);
  }

  /** Số in-app chưa đọc. */
  @Get('unread-count')
  async unread() {
    return { count: await this.service.unreadCount() };
  }

  /** Đánh dấu 1 thông báo đã đọc. */
  @Post(':id/read')
  async read(@Param('id') id: string) {
    await this.service.markRead(id);
    return { id };
  }

  /** Đánh dấu tất cả đã đọc. */
  @Post('read-all')
  async readAll() {
    return { count: await this.service.markAllRead() };
  }
}
