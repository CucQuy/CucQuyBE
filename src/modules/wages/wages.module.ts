import { Module } from '@nestjs/common';
import { WagesController } from './wages.controller';
import { WagesService } from './wages.service';
import { WagesProc } from './wages.proc';

/** Mức lương giờ theo vị trí + lịch sử thay đổi. */
@Module({
  controllers: [WagesController],
  providers: [WagesService, WagesProc],
})
export class WagesModule {}
