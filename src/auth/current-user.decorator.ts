import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './user.types';

/** Lấy user đã xác thực từ request (do SsoAuthGuard gắn). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
