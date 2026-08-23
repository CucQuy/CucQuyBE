import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { Employee, EmployeeInput, EmployeeWageRate } from './employees.types';

/** Tầng gọi stored function employee_* (raw SQL). */
@Injectable()
export class EmployeesProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<Array<{ result: Employee[] }>> {
    return this.db.sql<Array<{ result: Employee[] }>>`
      SELECT employee_list() AS result`;
  }

  create(input: EmployeeInput): Promise<Array<{ result: Employee }>> {
    return this.db.sql<Array<{ result: Employee }>>`
      SELECT employee_create(${this.db.json(input)}::jsonb) AS result`;
  }

  update(
    id: string,
    input: EmployeeInput,
  ): Promise<Array<{ result: Employee | null }>> {
    return this.db.sql<Array<{ result: Employee | null }>>`
      SELECT employee_update(${id}, ${this.db.json(input)}::jsonb) AS result`;
  }

  delete(id: string): Promise<Array<{ result: { ok: boolean; reason?: string } }>> {
    return this.db.sql<Array<{ result: { ok: boolean; reason?: string } }>>`
      SELECT employee_delete(${id}) AS result`;
  }

  // ── Mức lương/giờ theo NV (deal riêng + lịch sử) ──
  wageList(employeeId: string): Promise<Array<{ result: EmployeeWageRate[] }>> {
    return this.db.sql<Array<{ result: EmployeeWageRate[] }>>`
      SELECT employee_wage_list(${employeeId}) AS result`;
  }

  wageAdd(input: unknown): Promise<Array<{ result: EmployeeWageRate }>> {
    return this.db.sql<Array<{ result: EmployeeWageRate }>>`
      SELECT employee_wage_add(${this.db.json(input)}::jsonb) AS result`;
  }

  wageRemove(id: string): Promise<Array<{ result: { ok: boolean } }>> {
    return this.db.sql<Array<{ result: { ok: boolean } }>>`
      SELECT employee_wage_remove(${id}) AS result`;
  }
}
