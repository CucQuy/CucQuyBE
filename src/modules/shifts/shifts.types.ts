/** Ca làm định nghĩa (cố định, seed 3 ca). weekdays = ISO dow 1=T2..7=CN áp dụng. */
export interface WorkShift {
  code: string; // 'ca1' | 'ca2' | 'ca3'
  name: string;
  startTime: string; // 'HH:MM'
  endTime: string; // 'HH:MM'
  congFactor: number; // 1 ca = ? công
  sortOrder: number;
  weekdays: number[]; // [1..7] ISO dow áp dụng
  active: boolean;
}

/** 1 item khi lưu cài đặt ca. */
export interface WorkShiftSaveItem {
  code: string;
  name?: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  congFactor?: number;
  sortOrder?: number;
  active?: boolean;
}

/** 1 NV được xếp vào 1 ca của 1 ngày. */
export interface ShiftAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string; // yyyy-mm-dd
  shiftCode: string;
  note: string | null;
}

export interface RangeInput {
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
}

/** Đặt trọn danh sách NV cho 1 (ngày, ca). */
export interface SetDayInput {
  workDate: string; // yyyy-mm-dd
  shiftCode: string;
  employeeIds: string[];
}
