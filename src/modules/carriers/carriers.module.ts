import { Module } from '@nestjs/common';
import { CarriersController } from './carriers.controller';
import { CarriersService } from './carriers.service';
import { CarrierProc } from './carriers.proc';

@Module({
  controllers: [CarriersController],
  providers: [CarriersService, CarrierProc],
})
export class CarriersModule {}
