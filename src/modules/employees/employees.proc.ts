import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { Employee, EmployeeInput } from './employees.types';

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
}
