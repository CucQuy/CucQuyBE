import { Module } from '@nestjs/common';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService], // OrdersModule dùng để tính giảm khi tạo đơn
})
export class PromotionsModule {}
