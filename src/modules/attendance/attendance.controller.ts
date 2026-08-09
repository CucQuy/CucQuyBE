import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser, UserRole } from '../../auth/user.types';
import { AttendanceService } from './attendance.service';
import { CheckDto, RegisterFaceDto, UpsertNetworkDto } from './dto/attendance.dto';

type UploadFile = { buffer: Buffer; originalname: string; mimetype: string };

/**
 * Chấm công (Face ID + giới hạn IP mạng quán).
 *  - Route KHÔNG có @Roles: mọi tài khoản đã đăng nhập (NV) — luồng chấm công của chính mình.
 *  - Route có @Roles(admin/super_admin): quản lý (cấu hình IP, lịch sử, đăng ký hộ...).
 */
@ApiTags('Chấm công')
@Controller('attendance')
@UseGuards(SsoAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  /** IP thật của client sau Cloudflare Tunnel + k3s (giống request-logs). */
  private clientIp(req: Request): string {
    const header = (name: string): string => {
      const v = req.headers[name];
      const s = Array.isArray(v) ? v[0] : v;
      return (s ?? '').split(',')[0].trim();
    };
    const raw =
      header('cf-connecting-ip') ||
      header('x-forwarded-for') ||
      header('x-real-ip') ||
      req.ip ||
      req.socket?.remoteAddress ||
      '';
    return raw.replace(/^::ffff:/, '');
  }

  // ---- Nhân viên (self) ----

  @Get('me')
  me(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.me(user.email, this.clientIp(req));
  }

  @Post('register-face')
  @UseInterceptors(FileInterceptor('file'))
  registerFace(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadFile,
    @Body() dto: RegisterFaceDto,
  ) {
    return this.service.registerFace(
      user.email,
      user.role,
      file,
      dto.employeeId,
      dto.reset === 'true' || dto.reset === '1',
    );
  }

  @Post('check')
  @UseInterceptors(FileInterceptor('file'))
  check(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadFile,
    @Body() dto: CheckDto,
    @Req() req: Request,
  ) {
    return this.service.check(user.email, file, dto.kind, this.clientIp(req), dto.note);
  }

  // ---- Quản lý (admin / super_admin) ----

  @Get('current-ip')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  currentIp(@Req() req: Request) {
    // Trả IP + dải gợi ý (IPv6 → /56) vì IPv6 đổi /128 theo từng thiết bị.
    return this.service.currentIpInfo(this.clientIp(req));
  }

  @Get('overview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  overview() {
    return this.service.overview();
  }

  @Get('history')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  history(
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.history({ employeeId, from, to, limit, offset });
  }

  @Get('networks')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  networks() {
    return this.service.listNetworks();
  }

  @Post('networks')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  upsertNetwork(@Body() dto: UpsertNetworkDto) {
    return this.service.upsertNetwork(dto);
  }

  @Delete('networks/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  deleteNetwork(@Param('id') id: string) {
    return this.service.deleteNetwork(id);
  }

  @Post('faces/:employeeId/clear')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  clearFace(@Param('employeeId') employeeId: string) {
    return this.service.clearFace(employeeId);
  }
}
