import { Module } from '@nestjs/common';
import { FacebookController, FacebookWebhookController } from './facebook.controller';
import { FacebookService } from './facebook.service';
import { FacebookProc } from './facebook.proc';

/** Facebook Messenger cho fanpage: webhook nhận tin + danh sách khách (PSID) + gửi tin. */
@Module({
  controllers: [FacebookWebhookController, FacebookController],
  providers: [FacebookService, FacebookProc],
  exports: [FacebookService],
})
export class FacebookModule {}
