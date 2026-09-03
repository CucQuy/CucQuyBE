import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Đọc cấu hình nhóm Zalo (bảng zalo_config / zalo_groups) cho lớp gửi tin. */
@Injectable()
export class ZaloProc {
  constructor(private readonly db: DbService) {}

  /**
   * Nhóm CHÍNH để gửi khi caller không truyền groupIds (vd cron nhắc lịch giao).
   * Lấy từ DB (user sửa được ở Cài đặt Zalo) → tránh lệch với env khi đổi nhóm.
   * Không có main_group_id → lấy nhóm đầu tiên có bật thông báo đơn hàng.
   */
  async mainGroupId(): Promise<string> {
    const [row] = await this.db.sql<{ id: string | null }[]>`
      SELECT COALESCE(
        NULLIF((SELECT main_group_id FROM zalo_config WHERE id = 'zalo'), ''),
        (SELECT zalo_group_id FROM zalo_groups
          WHERE COALESCE(zalo_group_id,'') <> ''
            AND (notify_on_create IS DISTINCT FROM false OR notify_on_update IS DISTINCT FROM false)
          ORDER BY id LIMIT 1)
      ) AS id`;
    return (row?.id ?? '').trim();
  }
}
