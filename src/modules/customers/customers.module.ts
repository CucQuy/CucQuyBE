import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerProc } from './customers.proc';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerProc],
})
export class CustomersModule {}
