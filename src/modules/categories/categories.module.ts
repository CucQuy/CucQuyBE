import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategoryProc } from './categories.proc';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, CategoryProc],
})
export class CategoriesModule {}
