import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { ShiftsProc } from './shifts.proc';

/** Ca làm + lịch phân ca (nối chấm công/lương ở giai đoạn sau). */
@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftsProc],
})
export class ShiftsModule {}
