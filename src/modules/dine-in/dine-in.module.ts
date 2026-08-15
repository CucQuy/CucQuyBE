import { Module } from '@nestjs/common';
import { DineInController } from './dine-in.controller';
import { DineInService } from './dine-in.service';
import { DineInProc } from './dine-in.proc';
import { EventsModule } from '../events/events.module';

/** Order theo bàn (dine-in) — bàn ăn tại chỗ gắn đơn hàng thật. */
@Module({
  imports: [EventsModule],
  controllers: [DineInController],
  providers: [DineInService, DineInProc],
})
export class DineInModule {}
