import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FirestoreService } from '../firebase/firestore.service';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { IS_PUBLIC_KEY } from './roles.decorator';
import { AuthUser, UserRole } from './user.types';

/** TTL cache hồ sơ user (giây). Đổi role có hiệu lực chậm nhất sau ngần này. */
const USER_CACHE_TTL = 300;
export const userCacheKey = (uid: string) => `auth:user:${uid}`;

/** Phần hồ sơ lấy từ Postgres (cache được) — email lấy từ token, không cache. */
interface CachedProfile {
  role: UserRole | null;
  displayName: string | null;
}

/** Chuẩn hoá role thô về UserRole enum (giống normalizeRole của FE). */
function normalizeRole(raw: unknown): UserRole | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.toLowerCase();
  if (s === 'super_admin') return UserRole.SUPER_ADMIN;
  if (s === 'admin') return UserRole.ADMIN;
  if (s === 'colaborator') return UserRole.COLABORATOR;
  return undefined;
}

/**
 * Verify Firebase ID token (Authorization: Bearer <token>) bằng Firebase Auth,
 * nạp role từ bảng `users` ở Postgres (user_get), gắn AuthUser vào request.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly firestore: FirestoreService, // chỉ dùng .auth() để verify token
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thiếu Bearer token');
    }
    const token = header.slice('Bearer '.length).trim();

    let decoded: { uid: string; email?: string };
    try {
      decoded = await this.firestore.auth().verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }

    // Cache hồ sơ user → tránh đọc Postgres users trên MỖI request.
    // Miss/Redis lỗi → đọc Postgres rồi nạp lại cache (TTL ngắn).
    let profile = await this.redis.get<CachedProfile>(userCacheKey(decoded.uid));
    if (!profile) {
      const rows = await this.db.sql<
        { role: string | null; custom_name: string | null; display_name: string | null }[]
      >`SELECT role, custom_name, display_name FROM user_get(${decoded.uid})`;
      const data = rows[0] ?? { role: null, custom_name: null, display_name: null };
      profile = {
        role: normalizeRole(data.role) ?? null,
        displayName: data.custom_name ?? data.display_name ?? null,
      };
      await this.redis.set(userCacheKey(decoded.uid), profile, USER_CACHE_TTL);
    }

    const user: AuthUser = {
      uid: decoded.uid,
      email: decoded.email,
      role: profile.role ?? undefined,
      displayName: profile.displayName ?? undefined,
    };
    req.user = user;
    return true;
  }
}
