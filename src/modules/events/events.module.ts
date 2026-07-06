import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { NotificationsModule } from '../notifications/notifications.module';

/** Cung cấp EventsGateway cho các module cần bắn sự kiện realtime (vd webhooks). */
@Module({
  imports: [NotificationsModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
