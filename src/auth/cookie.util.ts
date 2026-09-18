import type { Request, Response } from 'express';

/**
 * Refresh token nằm trong cookie httpOnly do CHÍNH `api.cucquy.site` phát — không phải
 * RiceService (`api.riceservice.xyz`). Lý do: khác registrable domain thì cookie của
 * RiceService là third-party → Safari chặn thẳng, Chrome đang bỏ dần. Cookie host-only
 * của api.cucquy.site vẫn được gửi kèm request từ admin.cucquy.site vì cùng site
 * (`cucquy.site`) → SameSite=Lax là đủ, không cần SameSite=None.
 */
export const REFRESH_COOKIE = 'cq_rt';

/** Chỉ gửi cookie cho đúng nhóm route phiên — request nghiệp vụ không mang theo. */
const COOKIE_PATH = '/api/auth';

/** Sau proxy (trust proxy đã bật ở main.ts) → req.protocol phản ánh X-Forwarded-Proto. */
const isHttps = (req: Request): boolean => req.protocol === 'https';

/** Đọc refresh token từ cookie (tự parse, không cần cookie-parser). */
export const readRefreshCookie = (req: Request): string => {
  const raw = req.headers?.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
};

export const setRefreshCookie = (req: Request, res: Response, token: string, maxAgeDays: number): void => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(req), // local dev chạy http → không set Secure, không thì trình duyệt bỏ cookie
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: maxAgeDays * 24 * 60 * 60 * 1000,
  });
};

export const clearRefreshCookie = (req: Request, res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: isHttps(req), sameSite: 'lax', path: COOKIE_PATH });
};
