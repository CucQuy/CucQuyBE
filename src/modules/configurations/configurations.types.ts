/**
 * Types cho domain configurations. Mỗi config lưu 1 document riêng trong
 * collection 'configurations':
 *  - 'screen-visibility'      → ScreenConfiguration
 *  - 'zalo-configuration'     → ZaloGroupsConfiguration
 *  - 'shipping-configuration' → ShippingConfiguration
 * (Khớp đúng vị trí cũ FE đang dùng để không mất dữ liệu.)
 */

export type ScreenVisibilityMap = Record<string, boolean>;

export interface ScreenConfiguration {
  screenVisibility: ScreenVisibilityMap;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ZaloGroupConfig {
  id: string;
  name: string;
  zaloGroupId: string;
  memberUids: string[];
  notifyOnCreate?: boolean;
  notifyOnUpdate?: boolean;
  notifyOnDelete?: boolean;
  updateFieldWhitelist?: string[];
}

export interface ZaloGroupsConfiguration {
  groups: ZaloGroupConfig[];
  mainGroupId?: string;
  mainNotifyOnCreate?: boolean;
  mainNotifyOnUpdate?: boolean;
  mainNotifyOnDelete?: boolean;
  mainUpdateFieldWhitelist?: string[];
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

/** Fallback khi Firestore chưa có doc shipping. */
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

export interface PaymentConfiguration {
  bankCode: string;
  accountNumber: string;
  accountHolder: string;
  qrTemplate: string;
  updatedAt?: string;
}

/** Fallback khi DB chưa có row payment. */
export const DEFAULT_PAYMENT_CONFIG: PaymentConfiguration = {
  bankCode: 'BIDV',
  accountNumber: '96247HTTH1308',
  accountHolder: 'TON THAT ANH MINH',
  qrTemplate: 'compact',
};

/** Payload PUT zalo-groups (groups + main settings tùy chọn). */
export interface SaveZaloGroupsPayload {
  groups: ZaloGroupConfig[];
  mainGroupId?: string;
  mainNotifyOnCreate?: boolean;
  mainNotifyOnUpdate?: boolean;
  mainNotifyOnDelete?: boolean;
  mainUpdateFieldWhitelist?: string[];
}
