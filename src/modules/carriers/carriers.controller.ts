import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { CarriersService } from './carriers.service';
import { Carrier } from './carriers.proc';

/** Đơn vị vận chuyển (danh bạ) — xem: mọi user; ghi: admin/super_admin. */
@ApiTags('Đơn vị vận chuyển')
@Controller('carriers')
@UseGuards(SsoAuthGuard, RolesGuard)
export class CarriersController {
  constructor(private readonly service: CarriersService) {}

  @Get()
  list(): Promise<Carrier[]> {
    return this.service.list();
  }

  @Put()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  save(
    @Body()
    body: {
      id?: string;
      name: string;
      phone?: string;
      note?: string;
      type?: string;
      route?: string;
      station?: string;
      offices?: unknown[];
      routes?: unknown[];
      active?: boolean;
      sortOrder?: number;
    },
  ): Promise<Carrier[]> {
    return this.service.save(body);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  remove(@Param('id') id: string): Promise<Carrier[]> {
    return this.service.remove(id);
  }
}
