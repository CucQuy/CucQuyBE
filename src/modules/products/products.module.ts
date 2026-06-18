import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductProc } from './products.proc';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductProc],
})
export class ProductsModule {}
