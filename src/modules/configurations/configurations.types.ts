/**
 * Types cho domain configurations. Mỗi config lưu 1 document riêng trong
 * collection 'configurations':
 *  - 'screen-visibility'      → ScreenConfiguration
 *  - 'zalo-configuration'     → ZaloGroupsConfiguration
 *  - 'shipping-configuration' → ShippingConfiguration
 * (Khớp đúng vị trí cũ FE đang dùng để không mất dữ liệu.)
 */

export type ScreenVisibilityMap = Record<string, boolean>;
/** Override role được truy cập mỗi màn: { '/path': ['admin','staff'] }. Thiếu route → dùng mặc định FE. */
export type ScreenRolesMap = Record<string, string[]>;

/** Quyền hành động 1 module: { view, create, edit, delete }. */
export type ModuleActions = Record<string, boolean>;
/** Phân quyền module×hành động của 1 role: { orders: {view,create,...}, ... }. */
export type RolePermissions = Record<string, ModuleActions>;

/** Vai trò động (CRUD ở Cài đặt). built_in = role gốc, không cho xoá. */
export interface Role {
  key: string;
  name: string;
  sortOrder: number;
  builtIn: boolean;
  permissions?: RolePermissions;
}

export interface ScreenConfiguration {
  screenVisibility: ScreenVisibilityMap;
  screenRoles?: ScreenRolesMap;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ZaloGroupConfig {
  id: string;
  name: string;
  zaloGroupId: string;
  /** CTV thuộc nhóm — nhóm CÓ member chỉ nhận đơn của member đó (nhóm CTV). */
  memberUids: string[];
  /** Tính năng thông báo nhóm này nhận (ZALO_NOTIFY_FEATURES) — thay 4 cờ notifyOn* cũ. */
  features: string[];
  updateFieldWhitelist?: string[];
}

export interface ZaloGroupsConfiguration {
  groups: ZaloGroupConfig[];
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface ShopOrigin {
  name: string;
  lat: number;
  lng: number;
  city: string;
}

export interface ShippingTier {
  maxKm: number;
  fee: number;
  label: string;
}

export interface ShippingConfiguration {
  shopOrigin: ShopOrigin;
  tiers: ShippingTier[];
  overFee: number;
  overLabel: string;
  updatedAt?: string;
  updatedBy?: string | null;
}

/** Fallback khi chưa có cấu hình shipping. */
export const DEFAULT_SHIPPING_CONFIG: ShippingConfiguration = {
  shopOrigin: {
    name: '30/10 Nguyễn Hữu Cảnh, An Cựu, Huế',
    lat: 16.4474994,
    lng: 107.6065567,
    city: 'Huế',
  },
  tiers: [
    { maxKm: 2, fee: 10000, label: '< 2 km' },
    { maxKm: 4, fee: 15000, label: '2 - 4 km' },
    { maxKm: 6, fee: 20000, label: '4 - 6 km' },
  ],
  overFee: 25000,
  overLabel: '> 6 km',
};

/** 1 tài khoản nhận tiền (multi-account; tối đa 1 isActive=true). */
export interface PaymentAccount {
  id: string;
  bankCode: string;
  accountNumber: string;
  accountHolder: string;
  qrTemplate: string;
  isActive: boolean;
  /** Đưa giao dịch của TK này vào Sổ giao dịch/đối soát (false → tx gắn is_test). */
  isTracked: boolean;
  createdAt: string; // ISO
}

/** Payload tạo tài khoản (qrTemplate optional, mặc định 'compact'). */
export interface CreatePaymentAccountPayload {
  bankCode: string;
  accountNumber: string;
  accountHolder: string;
  qrTemplate?: string;
}

/** 1 chức năng thông báo Zalo + cờ bật/tắt + nhóm đang nhận (màn "Chức năng"). */
export interface ZaloFeatureFlag {
  feature: string;
  enabled: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
  groups: { name: string; zaloGroupId: string }[];
}

/** Payload PUT zalo-features: chỉ ghi các feature có trong list. */
export interface SaveZaloFeaturesPayload {
  features: { feature: string; enabled: boolean }[];
}

/** Payload PUT zalo-groups (danh sách nhóm + tính năng thông báo mỗi nhóm). */
export interface SaveZaloGroupsPayload {
  groups: ZaloGroupConfig[];
}
