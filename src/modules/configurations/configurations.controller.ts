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
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/user.types';
import { ResponseMessage } from '../../common/response-message.decorator';
import { ConfigurationsService } from './configurations.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import {
  PaymentAccount,
  SaveZaloGroupsPayload,
  ScreenConfiguration,
  ScreenVisibilityMap,
  ScreenRolesMap,
  ShippingConfiguration,
  ZaloGroupsConfiguration,
} from './configurations.types';

@ApiTags('Cấu hình')
@Controller('configurations')
@UseGuards(SsoAuthGuard)
export class ConfigurationsController {
  constructor(private readonly service: ConfigurationsService) {}

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

  /** CTV có thuộc nhóm Zalo nào không (boolean). */
  @Get('collaborator-has-zalo/:uid')
  collaboratorHasZalo(@Param('uid') uid: string): Promise<boolean> {
    return this.service.collaboratorHasZaloGroup(uid);
  }

  // ==================== SHIPPING ====================

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

  /** Chọn tài khoản active (các tài khoản khác tự bỏ active). Trả danh sách mới. */
  @Put('payment-accounts/:id/active')
  @ResponseMessage('Đã chọn tài khoản nhận tiền')
  setActivePaymentAccount(
    @Param('id') id: string,
  ): Promise<PaymentAccount[]> {
    return this.service.setActivePaymentAccount(id);
  }

  /** Xoá tài khoản; nếu xoá cái active thì cái mới nhất còn lại thành active. Trả danh sách mới. */
  @Delete('payment-accounts/:id')
  @ResponseMessage('Đã xoá tài khoản nhận tiền')
  deletePaymentAccount(@Param('id') id: string): Promise<PaymentAccount[]> {
    return this.service.deletePaymentAccount(id);
  }
}
