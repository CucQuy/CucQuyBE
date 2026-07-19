import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { PosService } from './pos.service';
import { PosQrDto } from './dto/pos-qr.dto';

@ApiTags('POS device')
@Controller('pos')
@UseGuards(SsoAuthGuard, RolesGuard)
export class PosController {
  constructor(private readonly service: PosService) {}

  /** Đẩy QR thanh toán động lên màn hình thiết bị POS/ESP32 (lúc tạo/mở đơn). */
  @Post('qr')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  showQr(@Body() body: PosQrDto) {
    this.service.showQr(body);
    return { ok: true };
  }

  /** Xoá QR trên thiết bị (về màn chờ). */
  @Post('clear')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  clear() {
    this.service.clear();
    return { ok: true };
  }
}
