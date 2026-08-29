import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImagesModule } from '../images/images.module';
import { ZaloModule } from '../zalo/zalo.module';
import { QUEUE_SHIFT_REMINDERS } from '../../queue/queue.constants';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceProc } from './attendance.proc';
import { FaceService } from './face.service';
import { ShiftReminderService } from './shift-reminder.service';
import { ShiftReminderProcessor } from './shift-reminder.processor';

/** Chấm công nhân viên: Face ID (nhận diện server-side) + giới hạn IP mạng quán. */
@Module({
  imports: [
    ImagesModule,
    ZaloModule,
    BullModule.registerQueue({ name: QUEUE_SHIFT_REMINDERS }),
  ],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendanceProc,
    FaceService,
    ShiftReminderService,
    ShiftReminderProcessor,
  ],
})
export class AttendanceModule {}
