import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/roles.decorator';
import { IpThrottlerGuard } from '../../common/ip-throttler.guard';
import { ZaloProc } from './zalo.proc';

/**
 * Trang tra cứu đơn CÔNG KHAI cho khách (không đăng nhập) — mở từ link trong tin Zalo.
 * Chỉ trả field an toàn (order_public_status: KHÔNG địa chỉ đầy đủ / ghi chú nội bộ /
 * giá vốn / hoa hồng). Token sai → 404. Rate-limit theo IP để không bị quét token.
 */
@ApiTags('Public')
@Controller('public')
export class PublicOrderController {
  constructor(private readonly proc: ZaloProc) {}

  @Public()
  @UseGuards(IpThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('orders/:token')
  async getOrder(@Param('token') token: string) {
    const clean = String(token ?? '').trim();
    // Token là uuid bỏ gạch (32 hex) — sai dạng thì khỏi cần truy DB.
    if (!/^[0-9a-f]{32}$/i.test(clean)) throw new NotFoundException('ORDER_NOT_FOUND');
    const data = await this.proc.publicOrderByToken(clean);
    if (!data) throw new NotFoundException('ORDER_NOT_FOUND');
    return data;
  }
}
