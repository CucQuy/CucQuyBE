import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { EmployeesService } from './employees.service';
import { EmployeeInput } from './employees.types';

/** Quản lý hồ sơ nhân sự — chỉ super_admin/admin. */
@ApiTags('Nhân viên')
@Controller('employees')
@UseGuards(SsoAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: EmployeeInput) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: EmployeeInput) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
