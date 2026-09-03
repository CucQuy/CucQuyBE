import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ZaloController } from './zalo.controller';
import { ZaloService } from './zalo.service';
import { ZaloProc } from './zalo.proc';
import { CustomerNotifyService } from './customer-notify.service';
import { PublicOrderController } from './public-order.controller';
import { NotificationsProcessor } from './notifications.processor';
import { QUEUE_NOTIFICATIONS } from '../../queue/queue.constants';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS }),
    NotificationsModule,
  ],
  controllers: [ZaloController, PublicOrderController],
  providers: [ZaloService, ZaloProc, CustomerNotifyService, NotificationsProcessor],
  exports: [ZaloService, CustomerNotifyService],
})
export class ZaloModule {}
