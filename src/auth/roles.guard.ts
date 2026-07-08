import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { AuthUser, UserRole } from './user.types';

/** Kiểm tra role của user (đã được SsoAuthGuard gắn) so với @Roles. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException('Bạn không có quyền truy cập tài nguyên này');
    }
    return true;
  }
}
