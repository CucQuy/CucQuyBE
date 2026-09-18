import { Controller, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { IpThrottlerGuard } from '../common/ip-throttler.guard';
import { ResponseMessage } from '../common/response-message.decorator';
import { RiceSsoService } from './rice-sso.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './cookie.util';

/**
 * Vòng đời phiên đăng nhập. FE chỉ giữ access token (ngắn) trong bộ nhớ/localStorage;
 * refresh token nằm trong cookie httpOnly nên JS không đọc được.
 *
 * Còn dùng app là còn refresh được → không bị đá ra như trước (token 7 ngày, hết là văng).
 * Chỉ đăng xuất khi: user bấm đăng xuất, admin thu hồi, hoặc bỏ không dùng quá
 * `SSO_REFRESH_IDLE_DAYS` ngày.
 */
@Controller('auth')
export class SsoSessionController {
  constructor(private readonly rice: RiceSsoService) {}

  /**
   * Xoay vòng refresh token → access token mới. Cookie cũ được thay bằng token mới ngay,
   * token cũ chết → nếu ai đó trộm được bản sao, lần dùng sau sẽ lộ và cả phiên bị thu hồi.
   */
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UseGuards(IpThrottlerGuard)
  @ResponseMessage('Làm mới phiên thành công')
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedException('Chưa đăng nhập');
    try {
      const session = await this.rice.refresh(token);
      setRefreshCookie(req, res, session.refreshToken, this.rice.refreshIdleDays);
      return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
    } catch (e) {
      // Refresh hỏng hẳn → dọn cookie để FE không lặp vô ích ở lần tải trang sau.
      if (e instanceof UnauthorizedException) clearRefreshCookie(req, res);
      throw e;
    }
  }

  /** Đăng xuất: thu hồi phiên ở RiceService + xoá cookie. */
  @ResponseMessage('Đã đăng xuất')
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    if (token) await this.rice.logout(token);
    clearRefreshCookie(req, res);
    return { ok: true };
  }
}
