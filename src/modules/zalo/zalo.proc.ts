import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Thông tin đơn phục vụ gửi tin cho khách (order_customer_notify_info). */
export interface CustomerNotifyInfo {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  trackingNumber: string;
  trackingStatus: string;
  isTest: boolean;
  notifiedAt: string | null;
  optOut: boolean;
  deliveryDate: string | null;
  deliveryTime: string | null;
  deliveryType: string;
  total: number;
  paidAmount: number;
  items: { name: string; quantity: number }[];
}

/** Đọc cấu hình nhóm Zalo (bảng zalo_config / zalo_groups) + dữ liệu gửi tin cho khách. */
@Injectable()
export class ZaloProc {
  constructor(private readonly db: DbService) {}

  /** Cấu hình gửi tin cho KHÁCH + mã KM đang hiệu lực để chèn vào tin (1 lượt query). */
  async customerNotifyConfig(): Promise<{
    enabled: boolean;
    dailyLimit: number;
    promoCode: string;
    sentToday: number;
  }> {
    const [row] = await this.db.sql<
      {
        enabled: boolean | null;
        daily_limit: number | null;
        promo_code: string | null;
        sent_today: number | null;
      }[]
    >`
      SELECT c.customer_notify_enabled AS enabled,
             c.customer_notify_daily_limit AS daily_limit,
             (SELECT p.code FROM promotions p
               WHERE p.id = c.customer_notify_promotion_id
                 AND COALESCE(p.code, '') <> ''
                 -- status lưu chữ thường ('active') → so sánh không phân biệt hoa/thường.
                 AND lower(COALESCE(p.status, 'active')) = 'active'
                 -- start_at/end_at là timestamptz: KHÔNG so với '' hay now()::text,
                 -- Postgres cast '' → timestamptz ngay lúc plan nên cả query nổ
                 -- ("invalid input syntax for type timestamp with time zone") và
                 -- notify-customer 500 mọi lần gọi.
                 AND (p.start_at IS NULL OR p.start_at <= now())
                 AND (p.end_at IS NULL OR p.end_at >= now())
                 AND (p.max_uses IS NULL OR COALESCE(p.used_count, 0) < p.max_uses)
             ) AS promo_code,
             customer_notify_sent_today() AS sent_today
        FROM zalo_config c WHERE c.id = 'zalo'`;
    return {
      enabled: Boolean(row?.enabled),
      dailyLimit: typeof row?.daily_limit === 'number' ? row.daily_limit : 40,
      promoCode: (row?.promo_code ?? '').trim(),
      sentToday: typeof row?.sent_today === 'number' ? row.sent_today : 0,
    };
  }

  /** Thông tin đơn cần để quyết định gửi + dựng nội dung tin cho khách. */
  async orderNotifyInfo(orderId: string): Promise<CustomerNotifyInfo | null> {
    const [row] = await this.db.sql<{ info: CustomerNotifyInfo | null }[]>`
      SELECT order_customer_notify_info(${orderId}) AS info`;
    return row?.info ?? null;
  }

  /** Token trang tra cứu công khai của đơn (sinh nếu chưa có). */
  async ensurePublicToken(orderId: string): Promise<string> {
    const [row] = await this.db.sql<{ token: string | null }[]>`
      SELECT order_ensure_public_token(${orderId}) AS token`;
    return (row?.token ?? '').trim();
  }

  /** Đánh dấu đã gửi tin cho khách (chống gửi trùng). */
  async markCustomerNotified(orderId: string): Promise<void> {
    await this.db.sql`SELECT order_mark_customer_notified(${orderId})`;
  }

  /** Nhật ký gửi tin cho khách (màn "Trạng thái thông báo"). */
  async customerNotifyLog(
    status: string,
    limit: number,
    offset: number,
  ): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> | null }[]>`
      SELECT customer_notify_log(${status}, ${limit}, ${offset}) AS data`;
    return row?.data ?? { items: [], counts: { sent: 0, failed: 0, total: 0 } };
  }

  /** Ma trận đơn × kênh thông báo cho màn "Thông báo" trong khu vực Đơn hàng. */
  async orderNotifyMatrix(
    filter: string,
    limit: number,
    offset: number,
  ): Promise<Record<string, unknown>> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> | null }[]>`
      SELECT order_notify_matrix(${filter}, ${limit}, ${offset}) AS data`;
    return row?.data ?? { items: [], counts: { total: 0, sent: 0, failed: 0, none: 0 } };
  }

  /** Dữ liệu đơn cho trang tra cứu CÔNG KHAI (null nếu token sai). */
  async publicOrderByToken(token: string): Promise<Record<string, unknown> | null> {
    const [row] = await this.db.sql<{ data: Record<string, unknown> | null }[]>`
      SELECT order_public_status(${token}) AS data`;
    return row?.data ?? null;
  }

  /** Chức năng thông báo có đang BẬT không (096) — chưa có hàng cờ = bật. */
  async featureEnabled(feature: string): Promise<boolean> {
    const [row] = await this.db.sql<{ ok: boolean | null }[]>`
      SELECT zalo_feature_enabled(${feature}) AS ok`;
    return row?.ok !== false;
  }

  /**
   * ID nhóm Zalo được gán tính năng thông báo `feature` (095). Thay khái niệm
   * "nhóm chính"/"nhóm thanh toán" cũ — nhóm nào nhận gì do Cài đặt Zalo khai.
   */
  async groupIdsForFeature(feature: string): Promise<string[]> {
    const [row] = await this.db.sql<{ ids: string[] | null }[]>`
      SELECT zalo_group_ids_for_feature(${feature}) AS ids`;
    return (row?.ids ?? []).map((x) => x.trim()).filter(Boolean);
  }
}
