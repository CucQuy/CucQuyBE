import * as jwt from 'jsonwebtoken';

/**
 * Token cho LINK tải bảng lương (gửi qua Zalo). Ký HS256 để không giả mạo/dò được.
 * File KHÔNG lưu ở đâu — token chỉ chứa phạm vi (NV nào, kỳ nào); khi NV bấm link,
 * BE sinh lại file tại chỗ rồi stream. Token tự HẾT HẠN (mặc định 30 ngày).
 *
 * Secret: PAYROLL_LINK_SECRET, fallback SSO_JWT_SECRET (đã có sẵn, HS256 symmetric).
 * Claim `typ` tách biệt với token SSO → không dùng chéo được (verify SSO đòi email).
 */
const TYP = 'payroll-dl';

function secret(): string {
  return process.env.PAYROLL_LINK_SECRET || process.env.SSO_JWT_SECRET || '';
}

export interface PayrollLinkClaims {
  scope: 'emp' | 'full'; // file riêng 1 NV | file tổng
  employeeId?: string; // bắt buộc khi scope='emp'
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
}

/** Ký token tải; expiresInSec = số giây hết hạn (mặc định 30 ngày). */
export function signPayrollLink(
  claims: PayrollLinkClaims,
  expiresInSec: number = 60 * 60 * 24 * 30,
): string {
  return jwt.sign({ typ: TYP, ...claims }, secret(), {
    expiresIn: expiresInSec,
  });
}

/** Verify token; trả claims hoặc null nếu sai/hết hạn/không đúng loại. */
export function verifyPayrollLink(token: string): PayrollLinkClaims | null {
  try {
    const p = jwt.verify(token, secret()) as jwt.JwtPayload;
    if (p?.typ !== TYP) return null;
    if (p.scope !== 'emp' && p.scope !== 'full') return null;
    if (!p.from || !p.to) return null;
    if (p.scope === 'emp' && !p.employeeId) return null;
    return {
      scope: p.scope,
      employeeId: typeof p.employeeId === 'string' ? p.employeeId : undefined,
      from: String(p.from),
      to: String(p.to),
    };
  } catch {
    return null;
  }
}
