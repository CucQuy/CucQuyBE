import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { getClientIp } from '../../common/client-ip';
import { NetworkService } from './network.service';

/**
 * Global guard: chặn request tới controller bị bật "yêu cầu mạng được duyệt" khi
 * IP client ngoài dải cho phép. Không bao giờ chặn controller ngoài map (auth/config/
 * network/images...) → không thể tự khoá khỏi trang cài đặt để gỡ.
 */
@Injectable()
export class NetworkGuard implements CanActivate {
  constructor(private readonly network: NetworkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    // path dạng /api/<controller>/... → lấy segment sau 'api'.
    const parts = (req.path || '').split('/').filter(Boolean);
    const apiIdx = parts.indexOf('api');
    const controller = apiIdx >= 0 ? parts[apiIdx + 1] : parts[0];
    if (!controller) return true;

    const blocked = await this.network.isBlocked(controller, getClientIp(req));
    if (blocked) {
      throw new ForbiddenException('OFF_NETWORK'); // FE nhận diện để hiện màn "cần mạng quán"
    }
    return true;
  }
}
