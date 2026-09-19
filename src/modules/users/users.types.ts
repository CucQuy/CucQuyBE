/**
 * Types domain User — port từ FE (types/user.ts).
 * Giữ NGUYÊN shape để FE không phải sửa.
 */

export type UserStatus = 'pending' | 'active' | 'inactive';

export type UserRole = 'super_admin' | 'admin' | 'colaborator' | 'staff';

export interface UserData {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  customName?: string; // Tên gợi nhớ do admin đặt
  status: UserStatus; // pending, active, inactive
  createdAt: string; // ISO
  lastLoginAt: string; // ISO
  role: UserRole;
}
