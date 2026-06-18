import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** Row thô từ bảng users (snake_case) trả ra từ stored function. */
export type UserRow = {
  uid: string;
  email: string | null;
  display_name: string | null;
  custom_name: string | null;
  photo_url: string | null;
  role: string | null;
  status: string | null;
  zalo_ctv_group_chat_id: string | null;
  last_login_at: string | null;
  created_at: string | null;
};

/**
 * Tầng quản lý stored procedure của domain users.
 * Chỉ ở đây mới gọi user_* — service import class này để dùng.
 */
@Injectable()
export class UserProc {
  constructor(private readonly db: DbService) {}

  // ── Đọc ─────────────────────────────────────────────────────
  get(uid: string): Promise<UserRow[]> {
    return this.db.sql<UserRow[]>`SELECT * FROM user_get(${uid})`;
  }

  getByEmail(email: string): Promise<UserRow[]> {
    return this.db.sql<UserRow[]>`SELECT * FROM user_get_by_email(${email})`;
  }

  list(): Promise<UserRow[]> {
    return this.db.sql<UserRow[]>`SELECT * FROM user_list()`;
  }

  // ── Ghi ─────────────────────────────────────────────────────
  save(payload: unknown): Promise<UserRow[]> {
    return this.db
      .sql<UserRow[]>`SELECT * FROM user_save(${this.db.json(payload)}::jsonb)`;
  }

  updateStatus(uid: string, status: string): Promise<unknown> {
    return this.db.sql`SELECT user_update_status(${uid}, ${status})`;
  }

  updateCustomName(uid: string, customName: string): Promise<unknown> {
    return this.db
      .sql`SELECT user_update_custom_name(${uid}, ${customName})`;
  }

  updateRole(uid: string, role: string): Promise<unknown> {
    return this.db.sql`SELECT user_update_role(${uid}, ${role})`;
  }

  syncZaloGroups(uidToChat: Record<string, string>): Promise<unknown> {
    return this.db
      .sql`SELECT user_sync_zalo_groups(${this.db.json(uidToChat)}::jsonb)`;
  }
}
