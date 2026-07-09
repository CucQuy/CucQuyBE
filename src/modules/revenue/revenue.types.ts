/**
 * Types báo cáo doanh thu — port nguyên từ FE services/revenueService.ts.
 * Giữ NGUYÊN cấu trúc để số liệu khớp 100% với bản FE.
 */

export interface RevenuePoint {
  label: string;
  revenue: number;
  profit: number;
}

export interface RevenueReport {
  totalRevenue: number;
  orderCount: number;
  totalCommission: number;
  totalStockIn: number;
  totalExpenses: number;
  totalCosts: number;
  profit: number;
  margin: number;
  bankIn: number;
  /** bankIn - totalRevenue (đối chiếu ngân hàng vs doanh thu đơn) */
  bankInDelta: number;
  /** Tiền ra: tổng transactions transfer_type='out' trong kỳ (VND) */
  bankOut: number;
  /** Tiền ra đã KẾT TOÁN (về TK chính) — trung tính, KHÔNG trừ doanh thu (VND) */
  settledOut: number;
  /** Tiền ra CHƯA phân loại (chưa hoàn, chưa kết toán) — cần xử lý (VND) */
  unclassifiedOut: number;
  /** Tiền đã hoàn: tổng order_refunds.amount theo created_at trong kỳ (VND) */
  totalRefunded: number;
  /** Doanh thu thuần = totalRevenue - totalRefunded (VND) */
  netRevenue: number;
  /** Tổng giảm giá (KM) các đơn trong kỳ (VND) */
  totalDiscount: number;
  series: RevenuePoint[];
  costBreakdown: { stockIn: number; commission: number; expenses: number };
}
