import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser, UserRole } from '../../auth/user.types';
import { ResponseMessage } from '../../common/response-message.decorator';
import { ConfigurationsService } from './configurations.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { SetPaymentAccountTrackedDto } from './dto/set-payment-account-tracked.dto';
import { SetPaymentAccountKindDto } from './dto/set-payment-account-kind.dto';
import { SetPaymentAccountOpeningDto } from './dto/set-payment-account-opening.dto';
import {
  PaymentAccount,
  Role,
  SaveZaloFeaturesPayload,
  SaveZaloGroupsPayload,
  ScreenConfiguration,
  ScreenRolesMap,
  ScreenVisibilityMap,
  ShippingConfiguration,
  ZaloFeatureFlag,
  ZaloGroupsConfiguration,
} from './configurations.types';

@ApiTags('Cấu hình')
@Controller('configurations')
@UseGuards(SsoAuthGuard, RolesGuard)
export class ConfigurationsController {
  constructor(private readonly service: ConfigurationsService) {}

  // ==================== ROLES (vai trò động) ====================

  /** Danh sách vai trò (cho dropdown gán role + chip phân quyền màn). Mọi user đã đăng nhập. */
  @Get('roles')
  listRoles(): Promise<Role[]> {
    return this.service.listRoles();
  }

  /** Thêm/sửa vai trò — chỉ super_admin. */
  @Put('roles')
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage('Đã lưu vai trò')
  saveRole(@Body() body: { key?: string; name: string; sortOrder?: number }): Promise<Role[]> {
    return this.service.saveRole(body);
  }

  /** Lưu phân quyền module×hành động của 1 role — chỉ super_admin. */
  @Put('roles/:key/permissions')
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage('Đã lưu phân quyền')
  setRolePermissions(
    @Param('key') key: string,
    @Body() body: { permissions?: Record<string, Record<string, boolean>> },
  ): Promise<Role[]> {
    return this.service.setRolePermissions(key, body?.permissions ?? {});
  }

  /** Xoá vai trò (không xoá được role gốc / role đang có user) — chỉ super_admin. */
  @Delete('roles/:key')
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage('Đã xoá vai trò')
  deleteRole(@Param('key') key: string): Promise<Role[]> {
    return this.service.deleteRole(key);
  }

  // ==================== SCREEN ====================

  @Get('screen')
  getScreen(): Promise<ScreenConfiguration> {
    return this.service.fetchScreenConfiguration();
  }

  @Put('screen')
  @ResponseMessage('Đã lưu cấu hình màn hình')
  saveScreen(
    @Body() body: { screenVisibility: ScreenVisibilityMap; screenRoles?: ScreenRolesMap },
    @CurrentUser() user: AuthUser,
  ): Promise<ScreenConfiguration> {
    return this.service.saveScreenConfiguration(
      body?.screenVisibility,
      body?.screenRoles,
      user.displayName || user.email || user.uid,
    );
  }

  // ==================== ZALO GROUPS ====================

  @Get('zalo-groups')
  getZaloGroups(): Promise<ZaloGroupsConfiguration> {
    return this.service.fetchZaloGroupsConfiguration();
  }

  @Put('zalo-groups')
  @ResponseMessage('Đã lưu cấu hình nhóm Zalo')
  saveZaloGroups(
    @Body() body: SaveZaloGroupsPayload,
    @CurrentUser() user: AuthUser,
  ): Promise<ZaloGroupsConfiguration> {
    return this.service.saveZaloGroupsConfiguration(
      body,
      user.displayName || user.email || user.uid,
    );
  }

  // ==================== ZALO FEATURE FLAGS ====================

  /** Danh sách chức năng thông báo Zalo + đang bật/tắt + nhóm nào nhận. */
  @Get('zalo-features')
  getZaloFeatures(): Promise<ZaloFeatureFlag[]> {
    return this.service.fetchZaloFeatures();
  }

  @Put('zalo-features')
  @ResponseMessage('Đã lưu chức năng thông báo Zalo')
  saveZaloFeatures(
    @Body() body: SaveZaloFeaturesPayload,
    @CurrentUser() user: AuthUser,
  ): Promise<ZaloFeatureFlag[]> {
    return this.service.saveZaloFeatures(
      body,
      user.displayName || user.email || user.uid,
    );
  }

  /** CTV có thuộc nhóm Zalo nào không (boolean). */
  @Get('collaborator-has-zalo/:uid')
  collaboratorHasZalo(@Param('uid') uid: string): Promise<boolean> {
    return this.service.collaboratorHasZaloGroup(uid);
  }

  // ==================== SHIPPING ====================

  /** Mục tiêu doanh thu dùng chung (tháng + tối thiểu/kỳ vọng mỗi ngày). */
  @Get('revenue-goals')
  getRevenueGoals(): Promise<Record<string, unknown>> {
    return this.service.getRevenueGoals();
  }

  @Put('revenue-goals')
  @ResponseMessage('Đã lưu mục tiêu doanh thu')
  saveRevenueGoals(
    @Body() body: { monthlyTarget?: number; dailyMin?: number; dailyExpected?: number },
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.service.saveRevenueGoals(body ?? {}, user?.email);
  }

  @Get('shipping')
  getShipping(): Promise<ShippingConfiguration> {
    return this.service.fetchShippingConfiguration();
  }

  @Put('shipping')
  @ResponseMessage('Đã lưu cấu hình giao hàng')
  saveShipping(
    @Body() body: ShippingConfiguration,
    @CurrentUser() user: AuthUser,
  ): Promise<ShippingConfiguration> {
    return this.service.saveShippingConfiguration(
      body,
      user.displayName || user.email || user.uid,
    );
  }

  // ==================== PAYMENT ACCOUNTS (multi-account) ====================

  /** Danh sách tài khoản nhận tiền (active trước, mới nhất sau). */
  @Get('payment-accounts')
  listPaymentAccounts(): Promise<PaymentAccount[]> {
    return this.service.listPaymentAccounts();
  }

  /** Thêm tài khoản nhận tiền; tài khoản đầu tiên tự thành active. Trả danh sách mới. */
  @Post('payment-accounts')
  @ResponseMessage('Đã thêm tài khoản nhận tiền')
  createPaymentAccount(
    @Body() body: CreatePaymentAccountDto,
  ): Promise<PaymentAccount[]> {
    return this.service.createPaymentAccount(body);
  }

  /**
   * Bật/tắt GHI NHẬN giao dịch: tắt → webhook SePay của TK này bị bỏ qua, không lưu
   * giao dịch nào. Không tắt được TK đang dùng (HKD / cá nhân).
   */
  @Put('payment-accounts/:id/tracked')
  @ResponseMessage('Đã cập nhật ghi nhận giao dịch')
  setTrackedPaymentAccount(
    @Param('id') id: string,
    @Body() body: SetPaymentAccountTrackedDto,
  ): Promise<PaymentAccount[]> {
    return this.service.setTrackedPaymentAccount(id, body.tracked);
  }

  /**
   * Gán loại tài khoản (101): 'hkd' | 'personal' | 'none'. Mỗi loại thật chỉ 1 TK —
   * gán cho TK này thì TK cũ cùng loại tự rớt về 'none'.
   */
  @Put('payment-accounts/:id/kind')
  @ResponseMessage('Đã cập nhật loại tài khoản')
  setKindPaymentAccount(
    @Param('id') id: string,
    @Body() body: SetPaymentAccountKindDto,
  ): Promise<PaymentAccount[]> {
    return this.service.setKindPaymentAccount(id, body.kind);
  }

  /**
   * Chốt lại số dư tài khoản (102) theo số đang thấy trên app ngân hàng — mốc thời gian
   * đóng tại now(), từ đó chỉ cộng/trừ giao dịch mới.
   */
  @Put('payment-accounts/:id/opening')
  @ResponseMessage('Đã chốt số dư tài khoản')
  setOpeningPaymentAccount(
    @Param('id') id: string,
    @Body() body: SetPaymentAccountOpeningDto,
  ): Promise<PaymentAccount[]> {
    return this.service.setOpeningPaymentAccount(id, body.amount);
  }

  /** Xoá tài khoản; nếu xoá cái active thì cái mới nhất còn lại thành active. Trả danh sách mới. */
  @Delete('payment-accounts/:id')
  @ResponseMessage('Đã xoá tài khoản nhận tiền')
  deletePaymentAccount(@Param('id') id: string): Promise<PaymentAccount[]> {
    return this.service.deletePaymentAccount(id);
  }
}
