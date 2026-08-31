import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImagesModule } from '../images/images.module';
import { ZaloModule } from '../zalo/zalo.module';
import {
  QUEUE_SHIFT_REMINDERS,
  QUEUE_PAYROLL_CLOSING,
} from '../../queue/queue.constants';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceProc } from './attendance.proc';
import { FaceService } from './face.service';
import { ShiftReminderService } from './shift-reminder.service';
import { ShiftReminderProcessor } from './shift-reminder.processor';
import { PayrollExportService } from './payroll-export.service';
import { PayrollClosingService } from './payroll-closing.service';
import { PayrollClosingProcessor } from './payroll-closing.processor';
import { PayrollDownloadController } from './payroll-download.controller';

/** Chấm công nhân viên: Face ID (nhận diện server-side) + giới hạn IP mạng quán. */
@Module({
  imports: [
    ImagesModule,
    ZaloModule,
    BullModule.registerQueue(
      { name: QUEUE_SHIFT_REMINDERS },
      { name: QUEUE_PAYROLL_CLOSING },
    ),
  ],
  controllers: [AttendanceController, PayrollDownloadController],
  providers: [
    AttendanceService,
    AttendanceProc,
    FaceService,
    ShiftReminderService,
    ShiftReminderProcessor,
    PayrollExportService,
    PayrollClosingService,
    PayrollClosingProcessor,
  ],
})
export class AttendanceModule {}
