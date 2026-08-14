/** Ca làm định nghĩa (cố định, seed 3 ca). */
export interface WorkShift {
  code: string; // 'ca1' | 'ca2' | 'ca3'
  name: string;
  startTime: string; // 'HH:MM'
  endTime: string; // 'HH:MM'
  congFactor: number; // 1 ca = ? công
  sortOrder: number;
  active: boolean;
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
