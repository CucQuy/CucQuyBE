/** Loại lịch tự động (khớp compose function). */
export type ScheduleType =
  | 'daily_summary'
  | 'production_tomorrow'
  | 'delivery_today_tomorrow'
  | 'delivery_by_day';

export interface NotificationSchedule {
  id: string;
  type: ScheduleType;
  timeHHMM: string; // 'HH:MM' giờ VN
  days: number[]; // 0..6 (0=CN), rỗng = hằng ngày
  targetGroupIds: string[]; // rỗng = nhóm chính
  enabled: boolean;
  lastRunOn?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduleInput {
  type?: ScheduleType;
  timeHHMM?: string;
  days?: number[];
  targetGroupIds?: string[];
  enabled?: boolean;
}

/** 1 lịch đến hạn (từ notification_schedule_due). */
export interface DueSchedule {
  id: string;
  type: ScheduleType;
  targetGroupIds: string[];
  today: string; // 'YYYY-MM-DD' VN
}
