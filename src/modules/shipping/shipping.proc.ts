import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Tầng dữ liệu domain shipping — chỉ ở đây mới gọi stored function shipping_analytics(). */
@Injectable()
export class ShippingProc {
  constructor(private readonly db: DbService) {}

  /** Chỉ số theo DVVC trong kỳ (p_from/p_to NULL = toàn bộ). */
  async analytics(from: string | null, to: string | null): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> }[]>`
      SELECT shipping_analytics(${from}::date, ${to}::date) AS data`;
    return row?.data ?? {};
  }
}
