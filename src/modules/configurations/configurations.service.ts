import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigurationProc } from './configurations.proc';
import {
  CreatePaymentAccountPayload,
  DEFAULT_SHIPPING_CONFIG,
  PaymentAccount,
  PaymentAccountKind,
  Role,
  SaveZaloFeaturesPayload,
  SaveZaloGroupsPayload,
  ScreenConfiguration,
  ShippingConfiguration,
  ZaloFeatureFlag,
  ZaloGroupsConfiguration,
} from './configurations.types';

/** Service chỉ orchestration + map; mọi call DB qua ConfigurationProc. */
@Injectable()
export class ConfigurationsService {
  constructor(private readonly proc: ConfigurationProc) {}

  // ==================== ROLES (vai trò động) ====================

  async listRoles(): Promise<Role[]> {
    const [row] = await this.proc.roleList();
    return row.data;
  }

  async saveRole(p: unknown): Promise<Role[]> {
    const [row] = await this.proc.roleSave(p);
    return row.data;
  }

  async setRolePermissions(key: string, perms: unknown): Promise<Role[]> {
    const [row] = await this.proc.roleSetPermissions(key, perms);
    return row.data;
  }

  async deleteRole(key: string): Promise<Role[]> {
    try {
      const [row] = await this.proc.roleDelete(key);
      return row.data;
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '');
      if (msg.includes('ROLE_BUILTIN')) {
        throw new BadRequestException('Không thể xoá vai trò mặc định.');
      }
      if (msg.includes('ROLE_IN_USE')) {
        throw new BadRequestException('Vai trò đang được gán cho người dùng — gỡ trước khi xoá.');
      }
      throw e;
    }
  }

  // ==================== SCREEN ====================

  async fetchScreenConfiguration(): Promise<ScreenConfiguration> {
    const [row] = await this.proc.screenVisibilityGet();
    return row.data;
  }

  async saveScreenConfiguration(
    screenVisibility: unknown,
    screenRoles: unknown,
    _updatedBy?: string,
  ): Promise<ScreenConfiguration> {
    const [row] = await this.proc.screenVisibilitySave(screenVisibility, screenRoles);
    return row.data;
  }

  // ==================== ZALO GROUPS ====================

  async fetchZaloGroupsConfiguration(): Promise<ZaloGroupsConfiguration> {
    const [row] = await this.proc.zaloConfigGet();
    return row.data;
  }

  async saveZaloGroupsConfiguration(
    payload: SaveZaloGroupsPayload,
    _updatedBy?: string | null,
  ): Promise<ZaloGroupsConfiguration> {
    const [row] = await this.proc.zaloConfigSave(payload);
    return row.data;
  }

  // ==================== ZALO FEATURE FLAGS ====================

  async fetchZaloFeatures(): Promise<ZaloFeatureFlag[]> {
    const [row] = await this.proc.zaloFeaturesGet();
    return row.data ?? [];
  }

  async saveZaloFeatures(
    payload: SaveZaloFeaturesPayload,
    updatedBy?: string | null,
  ): Promise<ZaloFeatureFlag[]> {
    const [row] = await this.proc.zaloFeaturesSave(payload, updatedBy ?? null);
    return row.data ?? [];
  }

  // ==================== SHIPPING ====================

  async fetchShippingConfiguration(): Promise<ShippingConfiguration> {
    const [row] = await this.proc.shippingConfigGet();
    return row.data ?? DEFAULT_SHIPPING_CONFIG;
  }

  async saveShippingConfiguration(
    config: ShippingConfiguration,
    _updatedBy?: string | null,
  ): Promise<ShippingConfiguration> {
    const [row] = await this.proc.shippingConfigSave(config);
    return row.data ?? DEFAULT_SHIPPING_CONFIG;
  }

  // ==================== PAYMENT ACCOUNTS (multi-account) ====================

  async listPaymentAccounts(): Promise<PaymentAccount[]> {
    const [row] = await this.proc.paymentAccountsList();
    return row.data ?? [];
  }

  async createPaymentAccount(
    payload: CreatePaymentAccountPayload,
  ): Promise<PaymentAccount[]> {
    const [row] = await this.proc.paymentAccountCreate(payload);
    return row.data ?? [];
  }

  /** Bật/tắt đưa giao dịch của tài khoản vào Sổ giao dịch/đối soát. */
  async setTrackedPaymentAccount(
    id: string,
    tracked: boolean,
  ): Promise<PaymentAccount[]> {
    const [row] = await this.proc.paymentAccountSetTracked(id, tracked);
    return row.data ?? [];
  }

  /**
   * Gán loại tài khoản (101): hkd / personal / none. Mỗi loại thật chỉ 1 TK —
   * gán loại này cho TK mới thì TK cũ cùng loại tự rớt về 'none'.
   */
  async setKindPaymentAccount(
    id: string,
    kind: PaymentAccountKind,
  ): Promise<PaymentAccount[]> {
    const [row] = await this.proc.paymentAccountSetKind(id, kind);
    return row.data ?? [];
  }

  /** Chốt lại số dư tài khoản (102): ghi số dư mới + mốc thời gian = now(). */
  async setOpeningPaymentAccount(id: string, amount: number): Promise<PaymentAccount[]> {
    const [row] = await this.proc.paymentAccountSetOpening(id, amount);
    return row.data ?? [];
  }

  async deletePaymentAccount(id: string): Promise<PaymentAccount[]> {
    const [row] = await this.proc.paymentAccountDelete(id);
    return row.data ?? [];
  }

  /** Mục tiêu doanh thu (tháng + mỗi ngày) — dùng chung cho cả tiệm. */
  async getRevenueGoals(): Promise<Record<string, unknown>> {
    const [row] = await this.proc.revenueGoalsGet();
    return row?.data ?? {};
  }

  /** Lưu theo kiểu patch: gửi field nào ghi field đó. */
  async saveRevenueGoals(
    payload: Record<string, unknown>,
    updatedBy?: string,
  ): Promise<Record<string, unknown>> {
    const [row] = await this.proc.revenueGoalsSave({ ...payload, updatedBy });
    return row?.data ?? {};
  }
}
