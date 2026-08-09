export type AttendanceKind = 'in' | 'out';
export type AttendanceShift = 'ca1' | 'ca2' | 'ca3';

/** 1 lần chấm công. */
export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string | null;
  kind: AttendanceKind;
  shift: AttendanceShift | null; // ca suy ra theo giờ chấm
  checkedAt: string; // ISO
  ip: string | null;
  faceDistance: number | null;
  imageUrl: string | null;
  note: string | null;
}

/** Vào/ra của 1 ca trong ngày. */
export interface AttendanceShiftStatus {
  shift: AttendanceShift;
  in: string | null;
  out: string | null;
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
  nextKind: AttendanceKind; // hành động kế tiếp (in/out)
  currentShift: AttendanceShift | null; // ca mà lần chấm kế tiếp rơi vào (theo giờ hiện tại)
  todayIn: string | null;
  todayOut: string | null;
  todayCount: number;
  todayShifts: AttendanceShiftStatus[]; // vào/ra từng ca hôm nay
}

export interface IpStatus {
  configured: boolean; // đã cấu hình whitelist chưa
  allowed: boolean; // IP hiện tại có được phép
  ip: string;
}
