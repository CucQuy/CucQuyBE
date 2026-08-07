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
  status: EmployeeStatus;
  note: string | null;
  createdAt?: string;
  updatedAt?: string;
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
