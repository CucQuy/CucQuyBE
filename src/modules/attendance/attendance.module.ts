import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceProc } from './attendance.proc';
import { FaceService } from './face.service';

/** Chấm công nhân viên: Face ID (nhận diện server-side) + giới hạn IP mạng quán. */
@Module({
  imports: [ImagesModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceProc, FaceService],
})
export class AttendanceModule {}
