import { Injectable } from '@nestjs/common';
import { BadgesProc } from './badges.proc';
import {
  BadgesConfiguration,
  CustomerBadgeRule,
  OrderBadge,
  ProductBadge,
} from './badges.types';

/** Service chỉ orchestration + map; mọi call DB qua BadgesProc. */
@Injectable()
export class BadgesService {
  constructor(private readonly proc: BadgesProc) {}

  async fetchBadgesConfiguration(): Promise<BadgesConfiguration> {
    const rows = await this.proc.get();
    return rows[0]?.badges_get ?? { orderBadges: [], productBadges: [], customerRules: [] };
  }

  async saveBadgesConfiguration(
    orderBadges: OrderBadge[],
    productBadges: ProductBadge[],
    customerRules: CustomerBadgeRule[],
    _updatedBy?: string | null,
  ): Promise<void> {
    const payload = { orderBadges, productBadges, customerRules };
    await this.proc.saveAll(payload);
  }
}
