import { Module } from '@nestjs/common';
import { CommissionController } from './commission.controller';
import { CommissionService } from './commission.service';
import { CommissionProc } from './commission.proc';

@Module({
  controllers: [CommissionController],
  providers: [CommissionService, CommissionProc],
})
export class CommissionModule {}
