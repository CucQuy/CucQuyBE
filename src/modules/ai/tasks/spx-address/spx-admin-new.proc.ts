import { Injectable } from '@nestjs/common';
import { DbService } from '../../../../db/db.service';

/** Đọc danh mục hành chính MỚI 2 cấp của SPX (bảng spx_state_new / spx_ward_new). */
@Injectable()
export class SpxAdminNewProc {
  constructor(private readonly db: DbService) {}

  async loadAll(): Promise<{
    states: string[];
    wards: { state: string; ward: string }[];
  }> {
    const states = await this.db.sql<{ state: string }[]>`SELECT state FROM spx_state_new`;
    const wards = await this.db
      .sql<{ state: string; ward: string }[]>`SELECT state, ward FROM spx_ward_new`;
    return {
      states: states.map((r) => r.state),
      wards: wards.map((r) => ({ state: r.state, ward: r.ward })),
    };
  }
}
