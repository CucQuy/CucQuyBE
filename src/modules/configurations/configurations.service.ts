import { Injectable } from '@nestjs/common';
import { ConfigurationProc } from './configurations.proc';
import {
  DEFAULT_PAYMENT_CONFIG,
  DEFAULT_SHIPPING_CONFIG,
  PaymentConfiguration,
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
    _updatedBy?: string,
  ): Promise<ScreenConfiguration> {
    const [row] = await this.proc.screenVisibilitySave(screenVisibility);
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

  // ==================== PAYMENT ====================

  async fetchPaymentConfiguration(): Promise<PaymentConfiguration> {
    const [row] = await this.proc.paymentConfigGet();
    return row.data ?? DEFAULT_PAYMENT_CONFIG;
  }

  async savePaymentConfiguration(
    config: PaymentConfiguration,
    _updatedBy?: string | null,
  ): Promise<PaymentConfiguration> {
    const [row] = await this.proc.paymentConfigSave(config);
    return row.data ?? DEFAULT_PAYMENT_CONFIG;
  }
}
