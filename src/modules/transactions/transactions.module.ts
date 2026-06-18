import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { TransactionProc } from './transactions.proc';

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionProc],
})
export class TransactionsModule {}
