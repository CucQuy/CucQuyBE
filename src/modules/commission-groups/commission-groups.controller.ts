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
import { CommissionGroupsService } from './commission-groups.service';

@ApiTags('Nhóm hoa hồng')
@Controller('commission-groups')
@UseGuards(SsoAuthGuard)
export class CommissionGroupsController {
  constructor(private readonly service: CommissionGroupsService) {}

  /** Danh sách nhóm hoa hồng (seed defaults nếu rỗng). */
  @Get()
  fetchCommissionGroups() {
    return this.service.fetchCommissionGroups();
  }

  /** Tạo nhóm — trả về group mới có id. */
  @Post()
  createCommissionGroup(@Body() body: Record<string, unknown>) {
    return this.service.createCommissionGroup(body);
  }

  /** Cập nhật nhóm. */
  @Patch(':id')
  async updateCommissionGroup(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.service.updateCommissionGroup(id, body);
    return { id };
  }

  /** Xoá nhóm. */
  @Delete(':id')
  async deleteCommissionGroup(@Param('id') id: string) {
    await this.service.deleteCommissionGroup(id);
    return { id };
  }
}
