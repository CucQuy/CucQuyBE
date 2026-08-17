import { Module } from '@nestjs/common';
import { ConfigurationsController } from './configurations.controller';
import { ConfigurationsService } from './configurations.service';
import { ConfigurationProc } from './configurations.proc';

@Module({
  controllers: [ConfigurationsController],
  providers: [ConfigurationsService, ConfigurationProc],
  exports: [ConfigurationsService],
})
export class ConfigurationsModule {}
