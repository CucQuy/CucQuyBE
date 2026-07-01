import { Module } from '@nestjs/common';
import { FlavorsController } from './flavors.controller';
import { FlavorsService } from './flavors.service';
import { FlavorProc } from './flavors.proc';

@Module({
  controllers: [FlavorsController],
  providers: [FlavorsService, FlavorProc],
})
export class FlavorsModule {}
