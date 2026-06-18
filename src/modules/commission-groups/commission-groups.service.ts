import { Injectable } from '@nestjs/common';
import { CommissionGroupProc, CommissionGroupRow } from './commission-groups.proc';
import { CommissionGroup, CommissionTier } from './commission-groups.types';

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

const mapTiers = (raw: unknown): CommissionTier[] =>
  Array.isArray(raw)
    ? raw.map((t) => {
        const r = (t ?? {}) as Record<string, unknown>;
        return {
          minQty: num(r.minQty, 1),
          profitShareRate: num(r.profitShareRate, 0),
        };
      })
    : [];

const mapRow = (r: CommissionGroupRow): CommissionGroup => ({
  id: r.id,
  name: r.name ?? '',
  minMargin: num(r.min_margin, 0),
  maxMargin: num(r.max_margin, 1),
  tiers: mapTiers(r.tiers),
  profitShareRate:
    r.profit_share_rate == null ? undefined : num(r.profit_share_rate, 0),
  fallbackRate: num(r.fallback_rate, 0),
  order: r.sort_order ?? 0,
});

/** Service chỉ orchestration + map; mọi call DB qua CommissionGroupProc. */
@Injectable()
export class CommissionGroupsService {
  constructor(private readonly proc: CommissionGroupProc) {}

  /** Lấy danh sách nhóm hoa hồng kèm tiers (sắp theo order). */
  async fetchCommissionGroups(): Promise<CommissionGroup[]> {
    return (await this.proc.list()).map(mapRow);
  }

  /** Tạo nhóm mới (sinh id ở DB) + tiers — trả về group mới có id. */
  async createCommissionGroup(
    data: Record<string, unknown>,
  ): Promise<CommissionGroup> {
    const rows = await this.proc.create(data);
    return mapRow(rows[0]);
  }

  /** Cập nhật nhóm (partial) + thay tiers nếu gửi kèm. */
  async updateCommissionGroup(
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.proc.update(id, data);
  }

  /** Xoá nhóm (tiers tự cascade). */
  async deleteCommissionGroup(id: string): Promise<void> {
    await this.proc.delete(id);
  }
}
