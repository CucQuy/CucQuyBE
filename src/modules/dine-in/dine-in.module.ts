import { Module } from '@nestjs/common';
import { DineInController } from './dine-in.controller';
import { DineInService } from './dine-in.service';
import { DineInProc } from './dine-in.proc';

/** Order theo bàn (dine-in) — bàn ăn tại chỗ gắn đơn hàng thật. */
@Module({
  controllers: [DineInController],
  providers: [DineInService, DineInProc],
})
export class DineInModule {}
