import { Module } from '@nestjs/common';
import { CoachesController } from './coaches.controller';
import { CoachesService } from './coaches.service';
import { CoachesProc } from './coaches.proc';

@Module({
  controllers: [CoachesController],
  providers: [CoachesService, CoachesProc],
})
export class CoachesModule {}
