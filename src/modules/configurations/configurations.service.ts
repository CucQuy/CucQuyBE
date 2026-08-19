import { Injectable } from '@nestjs/common';
import { ConfigurationProc } from './configurations.proc';
import {
  CreatePaymentAccountPayload,
  DEFAULT_SHIPPING_CONFIG,
  PaymentAccount,
  SaveZaloGroupsPayload,
  ScreenConfiguration,
  ShippingConfiguration,
  ZaloGroupsConfiguration,
} from './configurations.types';

/** Service chỉ orchestration + map; mọi call DB qua ConfigurationProc. */
@Injectable()
export class ConfigurationsService {
  constructor(private readonly proc: ConfigurationProc) {}

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

  /**
   * CTV có thuộc 1 nhóm Zalo nào không (để chặn tạo đơn khi chưa gán nhóm).
   * Non-CTV / không tìm thấy user → coi như hợp lệ (true).
   */
  async collaboratorHasZaloGroup(uid: string): Promise<boolean> {
    const [row] = await this.proc.zaloCollaboratorHasGroup(uid);
    return row.ok;
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

  async setActivePaymentAccount(id: string): Promise<PaymentAccount[]> {
    const [row] = await this.proc.paymentAccountSetActive(id);
    return row.data ?? [];
  }

  async deletePaymentAccount(id: string): Promise<PaymentAccount[]> {
    const [row] = await this.proc.paymentAccountDelete(id);
    return row.data ?? [];
  }
}
