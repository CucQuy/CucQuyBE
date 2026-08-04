import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeesProc } from './employees.proc';

/** Hồ sơ nhân sự (nhân viên) — CRUD cơ bản. */
@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeesProc],
})
export class EmployeesModule {}
