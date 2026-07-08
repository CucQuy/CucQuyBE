import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/user.types';
import { UsersService } from './users.service';
import { UserRole, UserStatus, ZaloGroupConfigInput } from './users.types';

@ApiTags('Người dùng')
@Controller('users')
@UseGuards(SsoAuthGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  /** Tất cả users. */
  @Get()
  getAllUsers() {
    return this.service.getAllUsers();
  }

  /** Doc của chính user đang đăng nhập (tiện cho AuthContext). */
  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.service.getUserByUid(user.uid);
  }

  /** Tìm user theo email. */
  @Get('by-email/:email')
  getUserByEmail(@Param('email') email: string) {
    return this.service.getUserByEmail(email);
  }

  /** Tìm user theo uid. */
  @Get('by-uid/:uid')
  getUserByUid(@Param('uid') uid: string) {
    return this.service.getUserByUid(uid);
  }

  /**
   * Lưu/cập nhật doc của user đang đăng nhập (gọi ngay sau login).
   * uid/email/displayName lấy từ token; body (nếu có) được merge.
   */
  @Post('sync')
  saveUser(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.saveUser(
      {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
      },
      body || {},
    );
  }

  /** Cập nhật status. */
  @Patch(':uid/status')
  async updateUserStatus(
    @Param('uid') uid: string,
    @Body('status') status: UserStatus,
  ) {
    await this.service.updateUserStatus(uid, status);
    return { uid };
  }

  /** Cập nhật tên gợi nhớ. */
  @Patch(':uid/custom-name')
  async updateUserCustomName(
    @Param('uid') uid: string,
    @Body('customName') customName: string,
  ) {
    await this.service.updateUserCustomName(uid, customName);
    return { uid };
  }

  /** Cập nhật role. */
  @Patch(':uid/role')
  async updateUserRole(
    @Param('uid') uid: string,
    @Body('role') role: UserRole,
  ) {
    await this.service.updateUserRole(uid, role);
    return { uid };
  }

  /** Đồng bộ zaloCtvGroupChatId theo membership group Zalo. */
  @Post('sync-zalo-groups')
  async syncZaloGroups(@Body('groups') groups: ZaloGroupConfigInput[]) {
    await this.service.syncZaloCtvGroupFieldsFromGroups(groups || []);
    return { synced: true };
  }
}
