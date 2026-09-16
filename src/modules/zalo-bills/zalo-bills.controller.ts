import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { ZaloBillsService } from './zalo-bills.service';

/**
 * Nạp ảnh bill từ nhóm Zalo "Hoá đơn Tiệm" qua agent (giống relay máy in).
 * FE bấm "Nạp từ Zalo" → POST /zalo-bills/fetch → agent trả FILE DB + key → BE tự giải mã
 * (node:crypto + sql.js) + bóc URL + tải + convert JXL→JPG (WASM) → trả ảnh base64 cho FE
 * đưa vào modal nhập bill hàng loạt có sẵn. Không lib native.
 */
@ApiTags('Zalo Bills')
@Controller('zalo-bills')
@UseGuards(SsoAuthGuard, RolesGuard)
export class ZaloBillsController {
  constructor(private readonly service: ZaloBillsService) {}

  /** Danh sách máy (agent) đang online để FE hiển thị/chọn. */
  @Get('agents')
  agents() {
    return { agents: this.service.agents() };
  }

  /** Lấy ảnh bill có `sendDttm >= sinceTs` (ms; 0/thiếu = tất cả), tối đa 30. */
  @Post('fetch')
  fetch(@Body() body: { machineId?: string; sinceTs?: number }) {
    return this.service.sync(body?.machineId, Number(body?.sinceTs) || 0);
  }
}
