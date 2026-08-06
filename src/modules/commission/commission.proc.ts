import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { CollaboratorCommissionSummary } from './commission.types';

/**
 * Tầng quản lý stored procedure của domain commission.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class CommissionProc {
  constructor(private readonly db: DbService) {}

  /** Thống kê hoa hồng tất cả CTV (jsonb). */
  async summaries(): Promise<CollaboratorCommissionSummary[]> {
    const rows = await this.db.sql<{ data: CollaboratorCommissionSummary[] }[]>`
      SELECT commission_summaries() AS data`;
    return rows[0]?.data ?? [];
  }

  /** Hoa hồng của một CTV (jsonb). */
  async summary(uid: string, name: string): Promise<CollaboratorCommissionSummary> {
    const rows = await this.db.sql<{ data: CollaboratorCommissionSummary }[]>`
      SELECT commission_summary(${uid}, ${name}) AS data`;
    return rows[0]!.data;
  }

  /** Phân tích cộng tác viên (đơn + doanh thu theo người tạo) trong kỳ (p_from/p_to NULL = toàn bộ). */
  async analytics(from: string | null, to: string | null): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> }[]>`
      SELECT commission_analytics(${from}::date, ${to}::date) AS data`;
    return row?.data ?? {};
  }

  /** Đánh dấu các đơn đã/chưa trả hoa hồng. */
  async setPaid(orderIds: string[], paid: boolean): Promise<void> {
    await this.db.sql`SELECT commission_set_paid(${this.db.sql.array(orderIds)}, ${paid})`;
  }
}
