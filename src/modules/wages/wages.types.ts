/** 1 mức lương giờ của 1 vị trí, áp dụng từ effectiveDate cho các thứ weekdays. */
export interface WageRate {
  id: string;
  position: string;
  hourlyRate: number; // VND/giờ
  weekdays: number[]; // ISO dow 1=T2..7=CN
  effectiveDate: string; // yyyy-mm-dd
  note: string | null;
  createdAt?: string;
}

export interface WageRateInput {
  position: string;
  hourlyRate: number;
  weekdays: number[];
  effectiveDate: string;
  note?: string | null;
}
