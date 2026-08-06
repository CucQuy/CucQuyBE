import { Module } from '@nestjs/common';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ShippingProc } from './shipping.proc';

/** Trang Vận chuyển: thống kê chỉ số theo DVVC (stored function shipping_analytics). */
@Module({
  controllers: [ShippingController],
  providers: [ShippingService, ShippingProc],
})
export class ShippingModule {}
