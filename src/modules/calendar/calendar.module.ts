import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarProc } from './calendar.proc';

/** Màn Lịch — gộp đơn/ca/chấm công + sự kiện tự thêm. */
@Module({
  controllers: [CalendarController],
  providers: [CalendarService, CalendarProc],
})
export class CalendarModule {}
