import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AiModule } from '../ai/ai.module';
import { ZaloBillsController } from './zalo-bills.controller';
import { ZaloBillsService } from './zalo-bills.service';

/**
 * Cầu nạp bill từ nhóm Zalo qua agent + giải mã DB SQLCipher trên BE (0 lib native).
 * AiModule: dùng ReceiptStructureService phân tích bill TEXT (nhập tay) thành cấu trúc phiếu.
 */
@Module({
  imports: [EventsModule, AiModule],
  controllers: [ZaloBillsController],
  providers: [ZaloBillsService],
})
export class ZaloBillsModule {}
