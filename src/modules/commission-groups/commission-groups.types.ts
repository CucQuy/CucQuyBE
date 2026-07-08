/**
 * Types + defaults nhóm hoa hồng — port từ FE (frontend/types/commissionGroup.ts).
 * Giữ NGUYÊN dữ liệu defaults để bản BE khớp 100% bản FE cũ.
 */

/** Một bậc số lượng trong nhóm */
export interface CommissionTier {
  /** Số lượng tối thiểu (tính theo tháng/CTV/nhóm) để đạt bậc này. Bậc đầu nên = 1 */
  minQty: number;
  /** Tỷ lệ chia sẻ lợi nhuận của bậc (0–1), VD 0.20 = 20% của (P-C) */
  profitShareRate: number;
}

export interface CommissionGroup {
  id: string;
  name: string;
  /** Margin tối thiểu (0–1), inclusive */
  minMargin: number;
  /** Margin tối đa (0–1), exclusive (trừ nhóm cuối cùng) */
  maxMargin: number;
  /** Bậc % lợi nhuận theo số lượng (sắp theo minQty tăng dần) */
  tiers: CommissionTier[];
  /** @deprecated Dữ liệu cũ — dùng tiers thay thế. Giữ để tương thích doc cũ. */
  profitShareRate?: number;
  /** Fallback khi không có costPrice: % trên giá bán (0–1) */
  fallbackRate: number;
  /** Thứ tự hiển thị / so sánh */
  order: number;
}

export const DEFAULT_COMMISSION_GROUPS: Omit<CommissionGroup, 'id'>[] = [
  {
    name: 'Cơ bản',
    minMargin: 0,
    maxMargin: 0.25,
    fallbackRate: 0.03,
    order: 1,
    tiers: [
      { minQty: 1, profitShareRate: 0.15 },
      { minQty: 30, profitShareRate: 0.18 },
      { minQty: 60, profitShareRate: 0.22 },
    ],
  },
  {
    name: 'Trung bình',
    minMargin: 0.25,
    maxMargin: 0.45,
    fallbackRate: 0.05,
    order: 2,
    tiers: [
      { minQty: 1, profitShareRate: 0.2 },
      { minQty: 30, profitShareRate: 0.24 },
      { minQty: 60, profitShareRate: 0.28 },
    ],
  },
  {
    name: 'Tốt',
    minMargin: 0.45,
    maxMargin: 0.65,
    fallbackRate: 0.08,
    order: 3,
    tiers: [
      { minQty: 1, profitShareRate: 0.25 },
      { minQty: 30, profitShareRate: 0.3 },
      { minQty: 60, profitShareRate: 0.35 },
    ],
  },
  {
    name: 'Cao cấp',
    minMargin: 0.65,
    maxMargin: 1,
    fallbackRate: 0.1,
    order: 4,
    tiers: [
      { minQty: 1, profitShareRate: 0.3 },
      { minQty: 30, profitShareRate: 0.35 },
      { minQty: 60, profitShareRate: 0.4 },
    ],
  },
];
