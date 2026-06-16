import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PromotionsModule } from '../promotions/promotions.module';

@Module({
  imports: [PromotionsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
