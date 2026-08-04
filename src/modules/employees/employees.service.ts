import { Injectable } from '@nestjs/common';
import { EmployeesProc } from './employees.proc';
import { Employee, EmployeeInput } from './employees.types';

/** Orchestration domain nhân sự — CRUD cơ bản. */
@Injectable()
export class EmployeesService {
  constructor(private readonly proc: EmployeesProc) {}

  async list(): Promise<Employee[]> {
    const rows = await this.proc.list();
    return rows[0]?.result ?? [];
  }

  async create(input: EmployeeInput): Promise<Employee> {
    const rows = await this.proc.create(input);
    return rows[0].result;
  }

  async update(id: string, input: EmployeeInput): Promise<Employee | null> {
    const rows = await this.proc.update(id, input);
    return rows[0]?.result ?? null;
  }

  async delete(id: string): Promise<{ ok: boolean; reason?: string }> {
    const rows = await this.proc.delete(id);
    return rows[0].result;
  }
}
