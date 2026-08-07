export type AttendanceKind = 'in' | 'out';

/** 1 lần chấm công. */
export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string | null;
  kind: AttendanceKind;
  checkedAt: string; // ISO
  ip: string | null;
  faceDistance: number | null;
  imageUrl: string | null;
  note: string | null;
}

/** Dải mạng quán cho phép chấm công. */
export interface AllowedNetwork {
  id: string;
  label: string | null;
  ipCidr: string; // '113.161.10.20' hoặc '1.2.3.0/24'
  active: boolean;
  createdAt: string;
}

/** Hồ sơ NV suy ra từ email đăng nhập. */
export interface EmployeeRef {
  id: string;
  name: string;
  email: string | null;
  status: string;
  faceCount: number;
}

/** Trạng thái chấm công hôm nay của 1 NV. */
export interface AttendanceStatus {
  employeeId: string;
  faceCount: number;
  lastKind: AttendanceKind | null;
  lastAt: string | null;
  todayIn: string | null;
  todayOut: string | null;
  todayCount: number;
}

export interface IpStatus {
  configured: boolean; // đã cấu hình whitelist chưa
  allowed: boolean; // IP hiện tại có được phép
  ip: string;
}
