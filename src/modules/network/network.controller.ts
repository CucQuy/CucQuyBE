import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { getClientIp } from '../../common/client-ip';
import { NetworkService } from './network.service';

/** Cài đặt mạng hệ thống + trạng thái IP + guard theo màn. */
@ApiTags('Mạng hệ thống')
@Controller('network')
@UseGuards(SsoAuthGuard)
export class NetworkController {
  constructor(private readonly service: NetworkService) {}

  /** Trạng thái mạng của client + danh sách màn đang guard (FE dùng để chặn/hiện nav). */
  @Get('status')
  async status(@Req() req: Request) {
    const ip = getClientIp(req);
    const [ipStatus, guardedScreens] = await Promise.all([
      this.service.ipStatus(ip),
      this.service.guardedScreens(),
    ]);
    return { ...ipStatus, guardedScreens };
  }

  /** IP hiện tại + gợi ý CIDR để whitelist. */
  @Get('current-ip')
  currentIp(@Req() req: Request) {
    return this.service.currentIpInfo(getClientIp(req));
  }

  // ---- Quản lý (super_admin) ----
  @Get('networks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  networks() {
    return this.service.networks();
  }

  @Post('networks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  upsertNetwork(@Body() body: unknown) {
    return this.service.upsertNetwork(body);
  }

  @Delete('networks/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async deleteNetwork(@Param('id') id: string) {
    await this.service.deleteNetwork(id);
    return { id };
  }

  @Get('guard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  guardGet() {
    return this.service.guardedScreens();
  }

  @Put('guard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  guardSave(@Body() body: { routes?: string[] }) {
    return this.service.saveGuardedScreens(Array.isArray(body?.routes) ? body.routes : []);
  }
}
