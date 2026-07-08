import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { ResponseMessage } from '../../common/response-message.decorator';
import { FlavorsService } from './flavors.service';
import { ProductFlavor } from './flavors.types';

@ApiTags('Vị')
@Controller('flavors')
@UseGuards(SsoAuthGuard)
export class FlavorsController {
  constructor(private readonly service: FlavorsService) {}

  /** Lấy toàn bộ danh sách vị. */
  @Get()
  fetch(): Promise<ProductFlavor[]> {
    return this.service.fetchFlavors();
  }

  /** Lưu toàn bộ danh sách vị (ghi đè). */
  @Put()
  @ResponseMessage('Đã lưu vị')
  save(@Body() body: ProductFlavor[]): Promise<ProductFlavor[]> {
    return this.service.saveFlavors(body);
  }
}
