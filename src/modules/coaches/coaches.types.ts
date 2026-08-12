/** Nhà xe — danh bạ dùng lại cho hình thức giao "Ship xe khách". */
export interface Coach {
  id: string;
  name: string;
  phone?: string | null;
  route?: string | null;
  pickupPoint?: string | null;
  defaultFee?: number;
  note?: string | null;
  sortOrder?: number;
}
