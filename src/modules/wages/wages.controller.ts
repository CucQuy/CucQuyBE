import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { WagesService } from './wages.service';
import { WageRateInput } from './wages.types';

/** Mức lương giờ theo vị trí + lịch sử — chỉ super_admin/admin. */
@ApiTags('Mức lương')
@Controller('wages')
@UseGuards(SsoAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class WagesController {
  constructor(private readonly service: WagesService) {}

  /** Toàn bộ mức lương (mọi vị trí + lịch sử). */
  @Get()
  list() {
    return this.service.list();
  }

  /** Thêm 1 mức lương (1 bản ghi lịch sử). */
  @Post()
  add(@Body() body: WageRateInput) {
    return this.service.add(body);
  }

  /** Xoá 1 bản ghi mức lương. */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
