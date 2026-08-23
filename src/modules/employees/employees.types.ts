export type EmployeeStatus = 'active' | 'inactive';

/** Hồ sơ nhân sự (độc lập với tài khoản đăng nhập). */
export interface Employee {
  id: string;
  name: string;
  email: string | null; // email tài khoản đăng nhập (SSO) để chấm công. null = chưa gắn.
  position: string | null;
  phone: string | null;
  startDate: string | null; // yyyy-mm-dd
  baseSalary: number | null; // VND
  hourlyRate: number | null; // mức lương/giờ đang áp dụng (deal riêng NV). null = chưa đặt.
  status: EmployeeStatus;
  note: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** 1 mức lương/giờ theo ngày áp dụng của 1 NV (có lịch sử). */
export interface EmployeeWageRate {
  id: string;
  employeeId: string;
  hourlyRate: number; // VND/giờ
  effectiveDate: string; // yyyy-mm-dd
  note: string | null;
  createdAt?: string;
}

export interface EmployeeWageInput {
  hourlyRate: number;
  effectiveDate: string;
  note?: string | null;
}

export interface EmployeeInput {
  name: string;
  email?: string | null;
  position?: string | null;
  phone?: string | null;
  startDate?: string | null;
  baseSalary?: number | null;
  status?: EmployeeStatus;
  note?: string | null;
}
