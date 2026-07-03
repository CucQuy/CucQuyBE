/** Domain Notifications — nhật ký gửi (Zalo) + hộp thư in-app. */

export type NotificationKind = 'zalo' | 'inapp';
export type NotificationStatus = 'sent' | 'failed' | 'pending';

/** Payload ghi 1 thông báo (camelCase, khớp notification_log). */
export interface NotificationLogInput {
  kind: NotificationKind;
  category?: string;
  title?: string;
  body?: string;
  target?: string;
  status?: NotificationStatus;
  error?: string;
  payload?: unknown; // để gửi lại (Zalo)
  triggeredBy?: string;
}

/** 1 thông báo trả về FE. */
export interface Notification {
  id: string;
  kind: NotificationKind;
  category?: string | null;
  title?: string | null;
  body?: string | null;
  target?: string | null;
  status: NotificationStatus;
  error?: string | null;
  triggeredBy?: string | null;
  readAt?: string | null;
  createdAt?: string;
}

export interface NotificationListResult {
  items: Notification[];
  hasMore: boolean;
}
