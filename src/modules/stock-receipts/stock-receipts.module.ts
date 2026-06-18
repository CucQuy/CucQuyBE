import { Module } from '@nestjs/common';
import { OcrModule } from '../ocr/ocr.module';
import { GeminiModule } from '../gemini/gemini.module';
import { StockReceiptsController } from './stock-receipts.controller';
import { StockReceiptsService } from './stock-receipts.service';
import { StockReceiptProc } from './stock-receipts.proc';
import { BillPipelineService } from './bill-pipeline.service';

@Module({
  imports: [OcrModule, GeminiModule],
  controllers: [StockReceiptsController],
  providers: [StockReceiptsService, StockReceiptProc, BillPipelineService],
})
export class StockReceiptsModule {}
