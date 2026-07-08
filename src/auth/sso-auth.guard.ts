import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { IS_PUBLIC_KEY } from './roles.decorator';
import { AuthUser, UserRole } from './user.types';
import { verifySsoToken } from './sso.util';

/** TTL cache hồ sơ user (giây). Đổi role có hiệu lực chậm nhất sau ngần này. */
const USER_CACHE_TTL = 300;
export const userCacheKey = (uid: string) => `auth:user:${uid}`;

/** Phần hồ sơ lấy từ Postgres (cache được) — email lấy từ token, không cache. */
interface CachedProfile {
  uid: string;
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
 * Verify SSO JWT (Authorization: Bearer <token>) do RiceService phát (đăng nhập Google),
 * map email → user ở Postgres (uid + role), gắn AuthUser vào request.
 */
@Injectable()
export class SsoAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
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

    let email: string;
    try {
      email = verifySsoToken(token).email;
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }

    // Cache hồ sơ user (theo email) → tránh đọc Postgres users trên MỖI request.
    let profile = await this.redis.get<CachedProfile>(userCacheKey(email));
    if (!profile) {
      const rows = await this.db.sql<
        { uid: string; role: string | null; custom_name: string | null; display_name: string | null }[]
      >`SELECT uid, role, custom_name, display_name FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;
      const data = rows[0];
      if (!data) throw new UnauthorizedException('Tài khoản chưa được cấp quyền');
      profile = {
        uid: data.uid,
        role: normalizeRole(data.role) ?? null,
        displayName: data.custom_name ?? data.display_name ?? null,
      };
      await this.redis.set(userCacheKey(email), profile, USER_CACHE_TTL);
    }

    const user: AuthUser = {
      uid: profile.uid,
      email,
      role: profile.role ?? undefined,
      displayName: profile.displayName ?? undefined,
    };
    req.user = user;
    return true;
  }
}
