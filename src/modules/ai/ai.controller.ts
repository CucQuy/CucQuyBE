import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { IpThrottlerGuard } from '../../common/ip-throttler.guard';
import { ReceiptValidateService } from './tasks/receipt-validate/receipt-validate.service';
import { ReceiptStructureService } from './tasks/receipt-structure/receipt-structure.service';
import { SpxAddressService } from './tasks/spx-address/spx-address.service';
import { SpxWardService } from './tasks/spx-ward/spx-ward.service';
import { SpxWardInput } from './tasks/spx-ward/spx-ward.types';
import { SpxAddressOldService } from './tasks/spx-address-old/spx-address-old.service';

@ApiTags('AI')
@Controller('ai')
// Endpoint AI tốn quota/CPU: 200 lần/phút/IP (đủ cho bulk import ~2 AI/bill, chặn lạm dụng).
@Throttle({ default: { limit: 200, ttl: 60000 } })
@UseGuards(IpThrottlerGuard, SsoAuthGuard)
export class AiController {
  constructor(
    private readonly receiptValidate: ReceiptValidateService,
    private readonly receiptStructure: ReceiptStructureService,
    private readonly spxAddress: SpxAddressService,
    private readonly spxWard: SpxWardService,
    private readonly spxAddressOld: SpxAddressOldService,
  ) {}

  /** Kiểm tra OCR text có phải bill mua/bán hàng không. */
  @Post('validate-receipt')
  validateReceipt(@Body('ocrText') ocrText: string) {
    return this.receiptValidate.run(ocrText ?? '');
  }

  /** Cấu trúc hoá OCR text thành phiếu nhập hàng. */
  @Post('structure-receipt')
  structureReceipt(@Body('ocrText') ocrText: string) {
    return this.receiptStructure.run(ocrText ?? '');
  }

  /** Tách danh sách địa chỉ VN → Tỉnh/Xã chuẩn 2025 (dùng khi xuất file tạo đơn SPX). */
  @Post('spx-address')
  async extractSpxAddress(@Body('addresses') addresses: string[]) {
    const items = await this.spxAddress.run(Array.isArray(addresses) ? addresses : []);
    return { items };
  }

  /** Chọn Xã chuẩn 2025 từ danh mục hợp lệ của tỉnh (grounded) cho đơn còn thiếu Xã. */
  @Post('spx-ward')
  async pickSpxWard(@Body('items') items: SpxWardInput[]) {
    const wards = await this.spxWard.run(Array.isArray(items) ? items : []);
    return { wards };
  }

  /** Tách địa chỉ → Tỉnh/Quận/Xã hệ CŨ 3 cấp (danh mục spx_*_old) để xuất file SPX "địa chỉ cũ". */
  @Post('spx-address-old')
  async extractSpxAddressOld(
    @Body() body: { addresses?: string[]; useAi?: boolean },
  ) {
    const addresses = Array.isArray(body?.addresses) ? body.addresses : [];
    const items = await this.spxAddressOld.run(addresses, body?.useAi !== false);
    return { items };
  }
}
