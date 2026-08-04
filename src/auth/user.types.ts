/** Khớp với UserRole của FE (types/user.ts). */
export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  COLABORATOR = 'colaborator',
  STAFF = 'staff',
}

/** Người dùng đã xác thực, gắn vào request sau khi verify ID token. */
export interface AuthUser {
  uid: string;
  email?: string;
  role: UserRole | undefined;
  displayName?: string;
}
