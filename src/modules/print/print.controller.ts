import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { EventsGateway } from '../events/events.gateway';
import { PrintJobDto } from './dto/print-job.dto';

/**
 * In bill/phiếu bếp từ BẤT KỲ thiết bị nào (điện thoại, máy khác) → relay qua BE.
 * FE render ESC/POS (raster) rồi POST base64 lên đây; BE đẩy qua socket.io tới
 * "agent máy in" chạy ở quán (ricevps, connect bằng PRINT_AGENT_TOKEN). Kiosk ở
 * quán vẫn in thẳng localhost:9110 (nhanh) — chỉ khi không có agent local FE mới
 * gọi endpoint này (xem FE utils/print/escpos.ts).
 */
@ApiTags('Print')
@Controller('print')
@UseGuards(SsoAuthGuard, RolesGuard)
export class PrintController {
  constructor(private readonly events: EventsGateway) {}

  /** Đẩy job in tới agent máy in đang online. Trả số agent nhận (0 = không có máy in online). */
  @Post('job')
  job(@Body() body: PrintJobDto): { printers: number } {
    const printers = this.events.emitPrintJob(body.base64);
    return { printers };
  }
}
