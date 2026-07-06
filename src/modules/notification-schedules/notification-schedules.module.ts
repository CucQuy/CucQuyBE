import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_SCHEDULES } from '../../queue/queue.constants';
import { NotificationSchedulesController } from './notification-schedules.controller';
import { NotificationSchedulesService } from './notification-schedules.service';
import { NotificationScheduleProc } from './notification-schedules.proc';
import { SchedulesProcessor } from './schedules.processor';
import { ZaloModule } from '../zalo/zalo.module';

/**
 * Lịch tự động gửi thông báo. Import ZaloModule để gửi (không chiều ngược lại
 * → tránh vòng lặp). Queue riêng QUEUE_SCHEDULES cho cron tick.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_SCHEDULES }), ZaloModule],
  controllers: [NotificationSchedulesController],
  providers: [NotificationSchedulesService, NotificationScheduleProc, SchedulesProcessor],
})
export class NotificationSchedulesModule {}
