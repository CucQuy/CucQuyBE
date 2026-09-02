import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { PrintController } from './print.controller';

/** In relay: FE POST /print/job → EventsGateway đẩy socket.io tới agent máy in ở quán. */
@Module({
  imports: [EventsModule],
  controllers: [PrintController],
})
export class PrintModule {}
