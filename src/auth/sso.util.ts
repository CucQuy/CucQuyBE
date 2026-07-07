import * as jwt from 'jsonwebtoken';

/** Claims trong SSO JWT do RiceService (/api/auth/google) phát ra. */
export interface SsoClaims {
  sub: string; // Google sub
  email: string;
  name?: string;
  picture?: string;
  provider?: string;
}

/**
 * Verify SSO JWT (HS256, ký bằng SSO_JWT_SECRET dùng chung với RiceService).
 * Throw nếu token sai/hết hạn hoặc thiếu email.
 */
export function verifySsoToken(token: string): SsoClaims {
  const secret = process.env.SSO_JWT_SECRET || '';
  const p = jwt.verify(token, secret) as jwt.JwtPayload;
  if (!p?.email) throw new Error('NO_EMAIL');
  return {
    sub: String(p.sub ?? ''),
    email: String(p.email).toLowerCase(),
    name: typeof p.name === 'string' ? p.name : undefined,
    picture: typeof p.picture === 'string' ? p.picture : undefined,
    provider: typeof p.provider === 'string' ? p.provider : undefined,
  };
}
