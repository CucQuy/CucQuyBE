import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

export interface Carrier {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  /** 'express' (truyền thống) | 'coach' (xe khách). */
  type: string;
  /** Tuyến chạy (xe khách). */
  route: string | null;
  /** Bến đỗ / điểm gửi-nhận (xe khách). */
  station: string | null;
  active: boolean;
  sortOrder: number;
}

/** Tầng gọi stored function carrier_* (jsonb). */
@Injectable()
export class CarrierProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<{ data: Carrier[] }[]> {
    return this.db.sql<{ data: Carrier[] }[]>`SELECT carrier_list() AS data`;
  }

  save(p: unknown): Promise<{ data: Carrier[] }[]> {
    return this.db.sql<{ data: Carrier[] }[]>`
      SELECT carrier_save(${this.db.json(p ?? {})}::jsonb) AS data`;
  }

  delete(id: string): Promise<{ data: Carrier[] }[]> {
    return this.db.sql<{ data: Carrier[] }[]>`SELECT carrier_delete(${id}) AS data`;
  }
}
