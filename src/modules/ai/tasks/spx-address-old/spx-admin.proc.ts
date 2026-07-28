import { Injectable } from '@nestjs/common';
import { DbService } from '../../../../db/db.service';

/** Đọc danh mục hành chính CŨ của SPX (bảng spx_state_old / spx_city_old / spx_ward_old). */
@Injectable()
export class SpxAdminProc {
  constructor(private readonly db: DbService) {}

  async loadAll(): Promise<{
    states: string[];
    cities: { state: string; city: string }[];
    wards: { city: string; ward: string }[];
  }> {
    const states = await this.db.sql<{ state: string }[]>`SELECT state FROM spx_state_old`;
    const cities = await this.db
      .sql<{ state: string; city: string }[]>`SELECT state, city FROM spx_city_old`;
    const wards = await this.db
      .sql<{ city: string; ward: string }[]>`SELECT city, ward FROM spx_ward_old`;
    return {
      states: states.map((r) => r.state),
      cities: cities.map((r) => ({ state: r.state, city: r.city })),
      wards: wards.map((r) => ({ city: r.city, ward: r.ward })),
    };
  }
}
