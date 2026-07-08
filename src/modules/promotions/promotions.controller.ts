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
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { ReopenPromotionDto } from './dto/reopen-promotion.dto';
import { PreviewPromotionDto } from './dto/preview-promotion.dto';

@ApiTags('Khuyến mãi')
@Controller('promotions')
@UseGuards(SsoAuthGuard, RolesGuard)
export class PromotionsController {
  constructor(private readonly service: PromotionsService) {}

  /** Danh sách khuyến mãi (mọi user đã đăng nhập xem được — để màn tạo đơn chọn). */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** Tính trước giảm giá cho giỏ hàng (màn tạo đơn gọi). */
  @Post('preview')
  preview(@Body() dto: PreviewPromotionDto) {
    return this.service.computeForCart(dto);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  create(@Body() dto: CreatePromotionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    await this.service.update(id, dto);
    return { id };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { id };
  }

  /** Mở lại chạy đợt mới (cất đợt hiện tại vào lịch sử, reset lượt). */
  @Post(':id/reopen')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async reopen(@Param('id') id: string, @Body() dto: ReopenPromotionDto) {
    await this.service.reopen(id, dto);
    return { id };
  }
}
