import { Module } from '@nestjs/common';
import { BadgesController } from './badges.controller';
import { BadgesService } from './badges.service';
import { BadgesProc } from './badges.proc';

@Module({
  controllers: [BadgesController],
  providers: [BadgesService, BadgesProc],
})
export class BadgesModule {}
