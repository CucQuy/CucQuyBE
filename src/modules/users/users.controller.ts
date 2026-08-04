import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { Public } from '../../auth/roles.decorator';
import { verifySsoToken } from '../../auth/sso.util';
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
  /**
   * Upsert user đang đăng nhập — PUBLIC (bypass SsoAuthGuard) vì user MỚI chưa có
   * trong DB, guard sẽ chặn 401 (chicken-and-egg). Tự verify SSO token ở đây, lấy
   * uid=sub/email/name/picture từ token (authoritative). User mới → tạo status
   * 'pending' để admin thấy + duyệt.
   */
  @Public()
  @Post('sync')
  saveUser(@Headers('authorization') authHeader: string | undefined) {
    const token = (authHeader ?? '').replace(/^Bearer\s+/i, '').trim();
    let claims;
    try {
      claims = verifySsoToken(token);
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
    if (!claims.sub) {
      throw new UnauthorizedException('Token thiếu subject (uid)');
    }
    return this.service.saveUser(
      { uid: claims.sub, email: claims.email ?? null, displayName: claims.name ?? null },
      { photoURL: claims.picture ?? null },
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
