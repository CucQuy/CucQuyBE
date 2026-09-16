// Kiểu dữ liệu cho kết quả payroll_compute (xem migrations/functions/payroll.sql).
// Field camelCase khớp jsonb trả về. Số tiền: VND. Ngày: 'yyyy-mm-dd'.

/** Chi tiết 1 ca trong ngày (đăng ký / đã làm / hợp lệ). */
export interface PayrollShift {
  code?: string;
  name?: string;
  registered?: boolean;
  worked?: boolean;
  valid?: boolean;
  status?: string; // valid | partial | no_checkout | missed | unregistered | off
  hours?: number; // giờ CHẤM của ca
  adjHours?: number; // giờ admin bổ sung gắn ca này
  totalHours?: number; // hours + adjHours
  pay?: number | null; // tiền của ca = totalHours × mức lương/giờ (null khi chưa đặt mức)
}

/** 1 ngày trong bảng công của NV. */
export interface PayrollDay {
  date: string; // yyyy-mm-dd
  cong: number; // số công quy đổi
  workHours: number; // giờ chấm thực tế hợp lệ
  adjHours: number; // giờ admin bổ sung
  hours: number; // tổng giờ tính lương (đã cắt trần 12h/ngày)
  rate: number; // mức lương/giờ áp dụng ngày đó (VND)
  pay: number; // thành tiền ngày (VND)
  registered: number; // số ca đăng ký
  valid: number; // số ca hợp lệ
  in: string | null; // giờ chấm vào (null nếu không chấm)
  out: string | null; // giờ chấm ra
  missingCheckout: boolean; // có lần chấm vào bị bỏ vì quên tan ca (ca dở dang không tính công)
  shifts: PayrollShift[];
}

/** Tổng hợp 1 NV trong kỳ. */
export interface PayrollEmployee {
  employeeId: string;
  name: string;
  position: string | null;
  totalHours: number;
  workHours: number;
  adjHours: number;
  totalCong: number;
  registeredShifts: number;
  validShifts: number;
  salary: number; // tổng lương kỳ (VND)
  days: PayrollDay[];
}

/** Kết quả payroll_compute cho cả kỳ. */
export interface PayrollResult {
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  totalSalary: number;
  totalHours: number;
  employees: PayrollEmployee[];
}
