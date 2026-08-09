import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  AllowedNetwork,
  AttendanceRecord,
  AttendanceStatus,
  EmployeeRef,
  IpStatus,
} from './attendance.types';

/** 1 mẫu khuôn mặt đã đăng ký (kèm vector để BE so khớp). */
export interface FaceSampleRow {
  id: string;
  descriptor: number[];
  imageUrl: string | null;
  createdAt: string;
}

export interface AttendanceListResult {
  items: AttendanceRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface AttendanceOverviewRow {
  employeeId: string;
  name: string;
  email: string | null;
  position: string | null;
  status: string;
  faceCount: number;
  todayIn: string | null;
  todayOut: string | null;
}

/** Tầng gọi stored function attendance_* / employee_face_* (raw SQL). */
@Injectable()
export class AttendanceProc {
  constructor(private readonly db: DbService) {}

  ipStatus(ip: string): Promise<Array<{ result: IpStatus }>> {
    return this.db.sql<Array<{ result: IpStatus }>>`
      SELECT attendance_ip_status(${ip}) AS result`;
  }

  /** Gợi ý dải CIDR để whitelist từ 1 IP (IPv6 → /56, IPv4 → /32). */
  suggestCidr(ip: string): Promise<Array<{ result: string }>> {
    return this.db.sql<Array<{ result: string }>>`
      SELECT attendance_suggest_cidr(${ip}) AS result`;
  }

  networksList(): Promise<Array<{ result: AllowedNetwork[] }>> {
    return this.db.sql<Array<{ result: AllowedNetwork[] }>>`
      SELECT attendance_networks_list() AS result`;
  }

  networksUpsert(input: unknown): Promise<Array<{ result: AllowedNetwork }>> {
    return this.db.sql<Array<{ result: AllowedNetwork }>>`
      SELECT attendance_networks_upsert(${this.db.json(input)}::jsonb) AS result`;
  }

  networksDelete(id: string): Promise<Array<{ result: { ok: boolean } }>> {
    return this.db.sql<Array<{ result: { ok: boolean } }>>`
      SELECT attendance_networks_delete(${id}) AS result`;
  }

  resolveByEmail(email: string): Promise<Array<{ result: EmployeeRef | null }>> {
    return this.db.sql<Array<{ result: EmployeeRef | null }>>`
      SELECT employee_resolve_by_email(${email}) AS result`;
  }

  faceList(employeeId: string): Promise<Array<{ result: FaceSampleRow[] }>> {
    return this.db.sql<Array<{ result: FaceSampleRow[] }>>`
      SELECT employee_face_list(${employeeId}) AS result`;
  }

  faceAdd(
    input: unknown,
  ): Promise<Array<{ result: { id: string; employeeId: string; faceCount: number } }>> {
    return this.db.sql<
      Array<{ result: { id: string; employeeId: string; faceCount: number } }>
    >`SELECT employee_face_add(${this.db.json(input)}::jsonb) AS result`;
  }

  faceClear(employeeId: string): Promise<Array<{ result: { ok: boolean; deleted: number } }>> {
    return this.db.sql<Array<{ result: { ok: boolean; deleted: number } }>>`
      SELECT employee_face_clear(${employeeId}) AS result`;
  }

  add(input: unknown): Promise<Array<{ result: AttendanceRecord }>> {
    return this.db.sql<Array<{ result: AttendanceRecord }>>`
      SELECT attendance_add(${this.db.json(input)}::jsonb) AS result`;
  }

  statusFor(employeeId: string): Promise<Array<{ result: AttendanceStatus }>> {
    return this.db.sql<Array<{ result: AttendanceStatus }>>`
      SELECT attendance_status_for(${employeeId}) AS result`;
  }

  list(input: unknown): Promise<Array<{ result: AttendanceListResult }>> {
    return this.db.sql<Array<{ result: AttendanceListResult }>>`
      SELECT attendance_list(${this.db.json(input)}::jsonb) AS result`;
  }

  overview(): Promise<Array<{ result: AttendanceOverviewRow[] }>> {
    return this.db.sql<Array<{ result: AttendanceOverviewRow[] }>>`
      SELECT attendance_overview() AS result`;
  }
}
