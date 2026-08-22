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
