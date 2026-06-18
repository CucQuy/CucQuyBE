import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { userCacheKey } from '../../auth/firebase-auth.guard';
import { UserProc, UserRow } from './users.proc';
import {
  UserData,
  UserRole,
  UserStatus,
  ZaloGroupConfigInput,
} from './users.types';

/** Chuẩn hoá status thô về UserStatus. */
function asStatus(raw: unknown): UserStatus {
  if (raw === 'active' || raw === 'inactive' || raw === 'pending') return raw;
  return 'pending';
}

/** Chuẩn hoá role thô về UserRole. */
function asRole(raw: unknown): UserRole {
  if (raw === 'super_admin' || raw === 'admin' || raw === 'colaborator') {
    return raw;
  }
  return 'colaborator';
}

/** Map row snake_case → UserData (camelCase, giữ shape FE). */
const mapRow = (r: UserRow): UserData => ({
  uid: r.uid,
  email: r.email ?? null,
  displayName: r.display_name ?? null,
  photoURL: r.photo_url ?? null,
  customName: r.custom_name ?? undefined,
  status: asStatus(r.status),
  createdAt: r.created_at ?? '',
  lastLoginAt: r.last_login_at ?? '',
  role: asRole(r.role),
  zaloCtvGroupChatId:
    r.zalo_ctv_group_chat_id === null ? null : r.zalo_ctv_group_chat_id,
});

/**
 * Đọc/ghi hồ sơ user — toàn bộ logic ở stored function app.user_*, gọi qua UserProc.
 * Service chỉ orchestration + map; mọi call DB qua UserProc.
 * LƯU Ý: xác thực vẫn do Firebase Auth (firebase-auth.guard) lo, KHÔNG ở đây.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly proc: UserProc,
    private readonly redis: RedisService,
  ) {}

  // ── Đọc ─────────────────────────────────────────────────────
  async getUserByUid(uid: string): Promise<UserData | null> {
    if (!uid) return null;
    const rows = await this.proc.get(uid);
    return rows.length ? mapRow(rows[0]) : null;
  }

  async getUserByEmail(email: string | null): Promise<UserData | null> {
    if (!email) return null;
    const rows = await this.proc.getByEmail(email);
    return rows.length ? mapRow(rows[0]) : null;
  }

  async getAllUsers(): Promise<UserData[]> {
    const rows = await this.proc.list();
    return rows.map(mapRow);
  }

  // ── Ghi ─────────────────────────────────────────────────────
  /**
   * Lưu/cập nhật user ngay sau khi đăng nhập.
   * - uid/email/displayName/photoURL lấy từ token (auth), merge cùng body FE (nếu có).
   * - Nếu user đã tồn tại (uid hoặc email) → chỉ cập nhật lastLoginAt, return bản ghi.
   * - Nếu chưa tồn tại → tạo mới status pending, role colaborator.
   * Toàn bộ logic nằm trong app.user_save.
   */
  async saveUser(
    auth: { uid: string; email?: string | null; displayName?: string | null },
    body: Record<string, unknown>,
  ): Promise<UserData> {
    const payload = {
      uid: auth.uid,
      email:
        typeof body.email === 'string' ? body.email : (auth.email ?? null),
      displayName:
        typeof body.displayName === 'string'
          ? body.displayName
          : (auth.displayName ?? null),
      photoURL: typeof body.photoURL === 'string' ? body.photoURL : null,
    };
    const rows = await this.proc.save(payload);
    return mapRow(rows[0]);
  }

  async updateUserStatus(uid: string, status: UserStatus): Promise<void> {
    await this.proc.updateStatus(uid, status);
  }

  async updateUserCustomName(uid: string, customName: string): Promise<void> {
    await this.proc.updateCustomName(uid, customName);
    await this.redis.del(userCacheKey(uid)); // displayName đổi → bỏ cache
  }

  async updateUserRole(uid: string, role: UserRole): Promise<void> {
    await this.proc.updateRole(uid, role);
    await this.redis.del(userCacheKey(uid)); // role đổi → bỏ cache để có hiệu lực ngay
  }

  /**
   * Ghi zaloCtvGroupChatId lên từng user theo membership group Zalo
   * (clear về null khi user không thuộc group nào). Port từ FE.
   */
  async syncZaloCtvGroupFieldsFromGroups(
    groups: ZaloGroupConfigInput[],
  ): Promise<void> {
    const uidToChat: Record<string, string> = {};
    for (const g of groups || []) {
      const chat = (g?.zaloGroupId ?? '').trim();
      if (!chat) continue;
      for (const uid of g.memberUids || []) {
        uidToChat[uid] = chat;
      }
    }
    await this.proc.syncZaloGroups(uidToChat);
  }
}
