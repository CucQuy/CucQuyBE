import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssetProc } from './assets.proc';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, AssetProc],
})
export class AssetsModule {}
