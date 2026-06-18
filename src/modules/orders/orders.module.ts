import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderProc } from './orders.proc';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrderProc],
})
export class OrdersModule {}
