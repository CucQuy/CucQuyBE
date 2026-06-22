import { Module } from '@nestjs/common';
import { SurchargeTagsController } from './surcharge-tags.controller';
import { SurchargeTagsService } from './surcharge-tags.service';
import { SurchargeTagProc } from './surcharge-tags.proc';

@Module({
  controllers: [SurchargeTagsController],
  providers: [SurchargeTagsService, SurchargeTagProc],
})
export class SurchargeTagsModule {}
