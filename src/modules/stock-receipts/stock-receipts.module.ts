import { Module } from '@nestjs/common';
import { OcrModule } from '../ocr/ocr.module';
import { AiModule } from '../ai/ai.module';
import { StockReceiptsController } from './stock-receipts.controller';
import { StockReceiptsService } from './stock-receipts.service';
import { StockReceiptProc } from './stock-receipts.proc';
import { BillPipelineService } from './bill-pipeline.service';
import { BillJobService } from './bill-job.service';

@Module({
  imports: [OcrModule, AiModule],
  controllers: [StockReceiptsController],
  providers: [StockReceiptsService, StockReceiptProc, BillPipelineService, BillJobService],
})
export class StockReceiptsModule {}
