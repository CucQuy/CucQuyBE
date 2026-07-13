import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { AssetsService } from './assets.service';
import { UpsertAssetDto } from './dto/upsert-asset.dto';

@ApiTags('Tài sản')
@Controller('assets')
@UseGuards(SsoAuthGuard)
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  upsert(@Body() dto: UpsertAssetDto) {
    return this.service.upsert(dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { ok: true };
  }
}
