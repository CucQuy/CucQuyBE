import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  PaymentAccount,
  Role,
  ScreenConfiguration,
  ShippingConfiguration,
  ZaloFeatureFlag,
  ZaloGroupsConfiguration,
} from './configurations.types';

/**
 * Tầng quản lý stored procedure của domain configurations.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 * Các function trả jsonb đúng shape FE cũ:
 *   screen_visibility_get/_save, shipping_config_get/_save,
 *   zalo_config_get/_save, zalo_collaborator_has_group.
 */
@Injectable()
export class ConfigurationProc {
  constructor(private readonly db: DbService) {}

  // ==================== ROLES (vai trò động) ====================

  roleList(): Promise<{ data: Role[] }[]> {
    return this.db.sql<{ data: Role[] }[]>`SELECT role_list() AS data`;
  }

  roleSave(p: unknown): Promise<{ data: Role[] }[]> {
    return this.db.sql<{ data: Role[] }[]>`
      SELECT role_save(${this.db.json(p ?? {})}::jsonb) AS data`;
  }

  roleDelete(key: string): Promise<{ data: Role[] }[]> {
    return this.db.sql<{ data: Role[] }[]>`SELECT role_delete(${key}) AS data`;
  }

  roleSetPermissions(key: string, perms: unknown): Promise<{ data: Role[] }[]> {
    return this.db.sql<{ data: Role[] }[]>`
      SELECT role_set_permissions(${key}, ${this.db.json(perms ?? {})}::jsonb) AS data`;
  }

  // ==================== SCREEN ====================

  screenVisibilityGet(): Promise<{ data: ScreenConfiguration }[]> {
    return this.db.sql<{ data: ScreenConfiguration }[]>`
      SELECT screen_visibility_get() AS data`;
  }

  screenVisibilitySave(
    screenVisibility: unknown,
    screenRoles: unknown,
  ): Promise<{ data: ScreenConfiguration }[]> {
    return this.db.sql<{ data: ScreenConfiguration }[]>`
      SELECT screen_visibility_save(
        ${this.db.json(screenVisibility ?? {})}::jsonb,
        ${this.db.json(screenRoles ?? {})}::jsonb
      ) AS data`;
  }

  // ==================== ZALO GROUPS ====================

  zaloConfigGet(): Promise<{ data: ZaloGroupsConfiguration }[]> {
    return this.db.sql<{ data: ZaloGroupsConfiguration }[]>`
      SELECT zalo_config_get() AS data`;
  }

  zaloFeaturesGet(): Promise<{ data: ZaloFeatureFlag[] }[]> {
    return this.db.sql<{ data: ZaloFeatureFlag[] }[]>`
      SELECT zalo_features_get() AS data`;
  }

  zaloFeaturesSave(
    payload: unknown,
    by?: string | null,
  ): Promise<{ data: ZaloFeatureFlag[] }[]> {
    return this.db.sql<{ data: ZaloFeatureFlag[] }[]>`
      SELECT zalo_features_save(${this.db.json(payload ?? {})}::jsonb, ${by ?? null}) AS data`;
  }

  zaloConfigSave(
    payload: unknown,
  ): Promise<{ data: ZaloGroupsConfiguration }[]> {
    return this.db.sql<{ data: ZaloGroupsConfiguration }[]>`
      SELECT zalo_config_save(${this.db.json(payload ?? {})}::jsonb) AS data`;
  }

  zaloCollaboratorHasGroup(uid: string): Promise<{ ok: boolean }[]> {
    return this.db.sql<{ ok: boolean }[]>`
      SELECT zalo_collaborator_has_group(${uid ?? ''}) AS ok`;
  }

  // ==================== SHIPPING ====================

  shippingConfigGet(): Promise<{ data: ShippingConfiguration | null }[]> {
    return this.db.sql<{ data: ShippingConfiguration | null }[]>`
      SELECT shipping_config_get() AS data`;
  }

  shippingConfigSave(
    config: unknown,
  ): Promise<{ data: ShippingConfiguration | null }[]> {
    return this.db.sql<{ data: ShippingConfiguration | null }[]>`
      SELECT shipping_config_save(${this.db.json(config ?? {})}::jsonb) AS data`;
  }

  // ==================== PAYMENT ACCOUNTS (multi-account) ====================

  paymentAccountsList(): Promise<{ data: PaymentAccount[] }[]> {
    return this.db.sql<{ data: PaymentAccount[] }[]>`
      SELECT payment_accounts_list() AS data`;
  }

  paymentAccountCreate(payload: unknown): Promise<{ data: PaymentAccount[] }[]> {
    return this.db.sql<{ data: PaymentAccount[] }[]>`
      SELECT payment_account_create(${this.db.json(payload ?? {})}::jsonb) AS data`;
  }

  paymentAccountSetActive(id: string): Promise<{ data: PaymentAccount[] }[]> {
    return this.db.sql<{ data: PaymentAccount[] }[]>`
      SELECT payment_account_set_active(${id ?? ''}) AS data`;
  }

  paymentAccountSetTracked(
    id: string,
    tracked: boolean,
  ): Promise<{ data: PaymentAccount[] }[]> {
    return this.db.sql<{ data: PaymentAccount[] }[]>`
      SELECT payment_account_set_tracked(${id ?? ''}, ${tracked}) AS data`;
  }

  /** Đổi mục đích TK: nhận tiền khách ↔ chi hoá đơn (099). */
  paymentAccountSetPurpose(
    id: string,
    purpose: string,
  ): Promise<{ data: PaymentAccount[] }[]> {
    return this.db.sql<{ data: PaymentAccount[] }[]>`
      SELECT payment_account_set_purpose(${id ?? ''}, ${purpose ?? 'receive'}) AS data`;
  }

  paymentAccountDelete(id: string): Promise<{ data: PaymentAccount[] }[]> {
    return this.db.sql<{ data: PaymentAccount[] }[]>`
      SELECT payment_account_delete(${id ?? ''}) AS data`;
  }

  // ── Mục tiêu doanh thu (092) ─────────────────────────────
  revenueGoalsGet(): Promise<{ data: Record<string, unknown> }[]> {
    return this.db.sql<{ data: Record<string, unknown> }[]>`
      SELECT revenue_goals_get() AS data`;
  }

  revenueGoalsSave(payload: unknown): Promise<{ data: Record<string, unknown> }[]> {
    return this.db.sql<{ data: Record<string, unknown> }[]>`
      SELECT revenue_goals_save(${this.db.json(payload ?? {})}::jsonb) AS data`;
  }
}
