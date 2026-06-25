import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../../auth/firebase-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/user.types';
import { ResponseMessage } from '../../common/response-message.decorator';
import { ConfigurationsService } from './configurations.service';
import { SavePaymentDto } from './dto/save-payment.dto';
import {
  PaymentConfiguration,
  SaveZaloGroupsPayload,
  ScreenConfiguration,
  ScreenVisibilityMap,
  ShippingConfiguration,
  ZaloGroupsConfiguration,
} from './configurations.types';

@ApiTags('Cấu hình')
@Controller('configurations')
@UseGuards(FirebaseAuthGuard)
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
    @Body() body: { screenVisibility: ScreenVisibilityMap },
    @CurrentUser() user: AuthUser,
  ): Promise<ScreenConfiguration> {
    return this.service.saveScreenConfiguration(
      body?.screenVisibility,
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

  // ==================== PAYMENT ====================

  @Get('payment')
  getPayment(): Promise<PaymentConfiguration> {
    return this.service.fetchPaymentConfiguration();
  }

  @Put('payment')
  @ResponseMessage('Đã lưu cấu hình thanh toán')
  savePayment(
    @Body() body: SavePaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentConfiguration> {
    return this.service.savePaymentConfiguration(
      body as PaymentConfiguration,
      user.displayName || user.email || user.uid,
    );
  }
}
