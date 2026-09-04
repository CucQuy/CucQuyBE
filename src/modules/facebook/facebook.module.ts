import { Module } from '@nestjs/common';
import { FacebookController, FacebookWebhookController } from './facebook.controller';
import { FacebookService } from './facebook.service';
import { FacebookProc } from './facebook.proc';
import { FacebookCommentsService } from './facebook-comments.service';
import { InstagramService } from './instagram.service';
import { SocialPostsService } from './social-posts.service';

/**
 * Facebook Messenger + bình luận fanpage, và Instagram Business đi kèm page
 * (cùng token, cùng bảng, phân biệt bằng cột `platform`).
 */
@Module({
  controllers: [FacebookWebhookController, FacebookController],
  providers: [FacebookService, FacebookCommentsService, InstagramService, SocialPostsService, FacebookProc],
  exports: [FacebookService, FacebookCommentsService, InstagramService, SocialPostsService],
})
export class FacebookModule {}
