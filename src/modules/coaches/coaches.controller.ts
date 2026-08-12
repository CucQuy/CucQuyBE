import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { ResponseMessage } from '../../common/response-message.decorator';
import { CoachesService } from './coaches.service';
import { Coach } from './coaches.types';

@ApiTags('Nhà xe')
@Controller('coaches')
@UseGuards(SsoAuthGuard)
export class CoachesController {
  constructor(private readonly service: CoachesService) {}

  /** Lấy toàn bộ danh bạ nhà xe. */
  @Get()
  fetch(): Promise<Coach[]> {
    return this.service.fetchCoaches();
  }

  /** Lưu toàn bộ danh bạ nhà xe (ghi đè). */
  @Put()
  @ResponseMessage('Đã lưu danh bạ nhà xe')
  save(@Body() body: Coach[]): Promise<Coach[]> {
    return this.service.saveCoaches(body);
  }
}
