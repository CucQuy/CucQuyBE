import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhookProc } from './webhooks.proc';
import { QUEUE_WEBHOOKS } from '../../queue/queue.constants';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_WEBHOOKS }), EventsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksProcessor, WebhookProc],
})
export class WebhooksModule {}
