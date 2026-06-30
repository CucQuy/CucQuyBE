import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

/** Cung cấp EventsGateway cho các module cần bắn sự kiện realtime (vd webhooks). */
@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
