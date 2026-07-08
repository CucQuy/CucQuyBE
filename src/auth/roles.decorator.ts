import { SetMetadata } from '@nestjs/common';
import { UserRole } from './user.types';

export const ROLES_KEY = 'roles';

/** Giới hạn route theo role. VD: @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN) */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Đánh dấu route public (bỏ qua SsoAuthGuard). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
