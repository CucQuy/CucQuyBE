/**
 * Badge system — 3 loại:
 *   1. OrderBadge: tag tự định nghĩa cho đơn (VIP / Quà tặng / Khẩn cấp...).
 *   2. ProductBadge: tag cho sản phẩm (Bán chạy / Mới / Sale / Signature / Hot...).
 *   3. CustomerBadgeRule: badge tự tính cho khách theo tiêu chí (đơn count, tổng chi).
 */

export interface OrderBadge {
  id: string;
  name: string;
  color: string;
  icon?: string;
  description?: string;
  sortOrder?: number;
}

export interface ProductBadge {
  id: string;
  name: string;
  color: string;
  icon?: string;
  description?: string;
  sortOrder?: number;
}

export type CustomerBadgeRuleType = 'orderCount' | 'totalSpent' | 'avgOrderValue';

export type CustomerBadgeOperator = '>=' | '>' | '<' | '<=';

export interface CustomerBadgeRule {
  id: string;
  name: string;
  color: string;
  icon?: string;
  ruleType: CustomerBadgeRuleType;
  operator: CustomerBadgeOperator;
  threshold: number;
  description?: string;
  sortOrder?: number;
}

export interface BadgesConfiguration {
  orderBadges: OrderBadge[];
  productBadges: ProductBadge[];
  customerRules: CustomerBadgeRule[];
}
