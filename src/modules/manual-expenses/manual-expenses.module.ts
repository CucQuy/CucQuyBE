import { Module } from '@nestjs/common';
import { ManualExpensesController } from './manual-expenses.controller';
import { ManualExpensesService } from './manual-expenses.service';
import { ManualExpenseProc } from './manual-expenses.proc';

@Module({
  controllers: [ManualExpensesController],
  providers: [ManualExpensesService, ManualExpenseProc],
})
export class ManualExpensesModule {}
