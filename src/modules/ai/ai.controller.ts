import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { IpThrottlerGuard } from '../../common/ip-throttler.guard';
import { ReceiptValidateService } from './tasks/receipt-validate/receipt-validate.service';
import { ReceiptStructureService } from './tasks/receipt-structure/receipt-structure.service';
import { OrderExtractService } from './tasks/order-extract/order-extract.service';
import {
  OrderExtractCatalogItem,
  OrderExtractImage,
} from './tasks/order-extract/order-extract.types';
import { ProductDescriptionService } from './tasks/product-description/product-description.service';
import { ProductForDescription } from './tasks/product-description/product-description.types';
import { SpxAddressService } from './tasks/spx-address/spx-address.service';
import { SpxWardService } from './tasks/spx-ward/spx-ward.service';
import { SpxWardInput } from './tasks/spx-ward/spx-ward.types';
import { SpxAddressOldService } from './tasks/spx-address-old/spx-address-old.service';

@ApiTags('AI')
@Controller('ai')
// Endpoint AI tốn quota/CPU (chủ yếu spx-address/spx-ward khi xuất đơn SPX):
// 200 lần/phút/IP — dư cho xuất hàng loạt, chặn lạm dụng.
@Throttle({ default: { limit: 200, ttl: 60000 } })
@UseGuards(IpThrottlerGuard, SsoAuthGuard)
export class AiController {
  constructor(
    private readonly receiptValidate: ReceiptValidateService,
    private readonly receiptStructure: ReceiptStructureService,
    private readonly orderExtract: OrderExtractService,
    private readonly productDescription: ProductDescriptionService,
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

  /** Quét ảnh khách đặt hàng (chat/giấy ghi tay) → dữ liệu điền sẵn form tạo đơn. */
  @Post('extract-order')
  extractOrder(
    @Body()
    body: { images?: OrderExtractImage[]; catalog?: OrderExtractCatalogItem[] },
  ) {
    return this.orderExtract.run(
      Array.isArray(body?.images) ? body.images : [],
      Array.isArray(body?.catalog) ? body.catalog : [],
    );
  }

  /** Gợi ý mô tả bán hàng cho 1 sản phẩm (nút "Gợi ý bằng AI" ở form sản phẩm). */
  @Post('product-description')
  async suggestProductDescription(@Body() body: ProductForDescription) {
    const description = await this.productDescription.run(body ?? ({} as ProductForDescription));
    return { description };
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
