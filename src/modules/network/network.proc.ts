import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

export interface IpStatus {
  configured: boolean;
  allowed: boolean;
  ip: string;
}

export interface NetworkRange {
  id: string;
  label: string | null;
  ipCidr: string;
  active: boolean;
  createdAt: string;
}

/** Tầng dữ liệu network guard — dùng CHUNG bảng attendance_allowed_networks. */
@Injectable()
export class NetworkProc {
  constructor(private readonly db: DbService) {}

  ipStatus(ip: string): Promise<Array<{ result: IpStatus }>> {
    return this.db.sql<Array<{ result: IpStatus }>>`
      SELECT network_ip_status(${ip}) AS result`;
  }

  guardGet(): Promise<Array<{ result: string[] }>> {
    return this.db.sql<Array<{ result: string[] }>>`
      SELECT network_guard_get() AS result`;
  }

  guardSave(routes: unknown): Promise<Array<{ result: string[] }>> {
    return this.db.sql<Array<{ result: string[] }>>`
      SELECT network_guard_save(${this.db.json(routes ?? [])}::jsonb) AS result`;
  }

  // Danh sách dải mạng — tái dùng function attendance (bảng chung).
  networksList(): Promise<Array<{ result: NetworkRange[] }>> {
    return this.db.sql<Array<{ result: NetworkRange[] }>>`
      SELECT attendance_networks_list() AS result`;
  }

  networksUpsert(input: unknown): Promise<Array<{ result: NetworkRange }>> {
    return this.db.sql<Array<{ result: NetworkRange }>>`
      SELECT attendance_networks_upsert(${this.db.json(input ?? {})}::jsonb) AS result`;
  }

  networksDelete(id: string): Promise<unknown> {
    return this.db.sql`SELECT attendance_networks_delete(${id})`;
  }

  suggestCidr(ip: string): Promise<Array<{ result: string }>> {
    return this.db.sql<Array<{ result: string }>>`
      SELECT attendance_suggest_cidr(${ip}) AS result`;
  }
}
