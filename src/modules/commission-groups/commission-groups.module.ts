import { Module } from '@nestjs/common';
import { CommissionGroupsController } from './commission-groups.controller';
import { CommissionGroupsService } from './commission-groups.service';
import { CommissionGroupProc } from './commission-groups.proc';

@Module({
  controllers: [CommissionGroupsController],
  providers: [CommissionGroupsService, CommissionGroupProc],
})
export class CommissionGroupsModule {}
