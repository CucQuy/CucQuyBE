import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationProc } from './notifications.proc';

/**
 * DbService global (DbModule @Global). Export NotificationsService để Zalo/Events
 * module ghi nhật ký (log) + gửi lại.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationProc],
  exports: [NotificationsService],
})
export class NotificationsModule {}
