import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit theo IP THẬT của client.
 *
 * Traffic đi qua Cloudflare → tunnel → traefik → nginx → app, nên req.ip
 * thường là IP của proxy nội bộ. Cloudflare gắn header `Cf-Connecting-Ip`
 * = IP thật của client → key theo header này để giới hạn "mỗi client",
 * không phải giới hạn tổng. Fallback về req.ip nếu thiếu header.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const cf = req.headers?.['cf-connecting-ip'];
    const ip = Array.isArray(cf) ? cf[0] : cf;
    return (typeof ip === 'string' && ip) || req.ip || 'unknown';
  }
}
