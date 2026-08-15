import { Module } from '@nestjs/common';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { RecipesProc } from './recipes.proc';

@Module({
  controllers: [RecipesController],
  providers: [RecipesService, RecipesProc],
})
export class RecipesModule {}
