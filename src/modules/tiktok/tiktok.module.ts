import { Module } from '@nestjs/common';
import { TiktokController, TiktokOauthController } from './tiktok.controller';
import { TiktokService } from './tiktok.service';
import { TiktokPublishService } from './tiktok-publish.service';
import { TiktokProc } from './tiktok.proc';

/**
 * TikTok cho "Kết nối đa kênh": Login Kit (OAuth), Display API (hồ sơ + video),
 * Content Posting API (đăng video). Token nằm trong DB vì TikTok đổi refresh token
 * sau mỗi lần refresh — xem `tiktok.service.ts`.
 */
@Module({
  controllers: [TiktokOauthController, TiktokController],
  providers: [TiktokService, TiktokPublishService, TiktokProc],
  exports: [TiktokService, TiktokPublishService],
})
export class TiktokModule {}
