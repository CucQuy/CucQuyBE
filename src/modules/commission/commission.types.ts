/**
 * Types hoa hồng — KHỚP shape jsonb trả về từ app.commission_* (commission.sql).
 * Mọi công thức tính nằm ở DB; đây chỉ là contract dữ liệu cho API/FE.
 */

export type CommissionStatus = 'pending' | 'paid';

export interface OrderItem {
  id: string;
  productId?: string;
  name: string;
  quantity: number;
  price: number;
  image?: string;
  // Bổ sung khi tính HH (do app.commission_summary trả ra)
  commissionAmount?: number;
  commissionGroupName?: string;
  commissionGroupQty?: number;
  commissionRate?: number;
}

export interface Order {
  id: string;
  orderNumber?: string;
  createdBy?: string;
  items?: OrderItem[];
  total?: number;
  shippingCost?: number;
  status?: string;
  deliveryDate?: string;
  commissionStatus?: CommissionStatus;
  commissionAmount?: number;
}

export interface CollaboratorCommissionSummary {
  collaboratorUid: string;
  collaboratorName: string;
  orders: Order[];
  totalSales: number;
  totalCommission: number;
  pendingCommission: number;
  paidCommission: number;
}
