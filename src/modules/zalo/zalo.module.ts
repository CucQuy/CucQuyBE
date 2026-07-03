import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ZaloController } from './zalo.controller';
import { ZaloService } from './zalo.service';
import { NotificationsProcessor } from './notifications.processor';
import { QUEUE_NOTIFICATIONS } from '../../queue/queue.constants';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS }),
    NotificationsModule,
  ],
  controllers: [ZaloController],
  providers: [ZaloService, NotificationsProcessor],
  exports: [ZaloService],
})
export class ZaloModule {}
