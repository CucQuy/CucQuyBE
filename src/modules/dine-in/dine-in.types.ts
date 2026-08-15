/** Types cho Order theo bàn (dine-in). camelCase = API contract (khớp FE). */

/** Tóm tắt đơn đang mở của 1 bàn (đủ hiển thị map + bảng danh sách). */
export interface DineInOpenOrder {
  id: string;
  orderNumber: string | null;
  guestCount: number | null;
  seatedAt: string | null; // ISO — giờ vào
  leftAt: string | null; // ISO — giờ ra (null = đang ngồi)
  total: number; // VND
  paidAmount: number; // VND
  status: string;
  paymentStatus: string;
  itemCount: number;
}

/** 1 bàn ăn tại chỗ + đơn đang mở (nếu có). */
export interface DineInTable {
  id: string;
  name: string;
  posX: number; // 0..1 theo khung sơ đồ
  posY: number; // 0..1 theo khung sơ đồ
  seats: number;
  sortOrder: number;
  active: boolean;
  currentOrder: DineInOpenOrder | null;
}

/** Input tạo/sửa bàn (id vắng = tạo mới). */
export interface DineInTableInput {
  id?: string;
  name?: string;
  posX?: number;
  posY?: number;
  seats?: number;
  sortOrder?: number;
}
