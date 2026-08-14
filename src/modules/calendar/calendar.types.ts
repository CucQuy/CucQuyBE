export type CalendarEventType = 'order' | 'shift' | 'custom' | 'attendance';

/** Event chuẩn hoá trên màn Lịch (gộp từ nhiều nguồn). */
export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  date: string; // yyyy-mm-dd
  title: string;
  subtitle?: string | null;
  time?: string | null; // HH:MM
  refId?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Sự kiện tự thêm (lưu DB). */
export interface CustomEvent {
  id: string;
  title: string;
  eventDate: string; // yyyy-mm-dd
  startTime: string | null;
  endTime: string | null;
  color: string | null;
  note: string | null;
}

export interface CustomEventInput {
  id?: string;
  title: string;
  eventDate: string;
  startTime?: string | null;
  endTime?: string | null;
  color?: string | null;
  note?: string | null;
}

export interface RangeInput {
  from: string;
  to: string;
}
