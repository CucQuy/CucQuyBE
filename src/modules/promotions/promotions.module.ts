import { Module } from '@nestjs/common';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { PromotionProc } from './promotions.proc';

@Module({
  controllers: [PromotionsController],
  providers: [PromotionsService, PromotionProc],
  exports: [PromotionsService], // OrdersModule dùng để tính giảm khi tạo đơn
})
export class PromotionsModule {}
