import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiClientService } from './core/ai-client.service';
import { ReceiptValidateService } from './tasks/receipt-validate/receipt-validate.service';
import { ReceiptStructureService } from './tasks/receipt-structure/receipt-structure.service';
import { MaterialMergeService } from './tasks/material-merge/material-merge.service';
import { SpxAddressService } from './tasks/spx-address/spx-address.service';

/**
 * Module AI: mỗi nghiệp vụ 1 service riêng trong tasks/<nghiệp-vụ>/ (service +
 * config + prompt.md), dùng chung AiClientService (core). Thêm nghiệp vụ mới =
 * tạo 1 folder trong tasks/ theo mẫu rồi đăng ký ở đây.
 */
@Module({
  controllers: [AiController],
  providers: [
    AiClientService,
    ReceiptValidateService,
    ReceiptStructureService,
    MaterialMergeService,
    SpxAddressService,
  ],
  exports: [
    ReceiptValidateService,
    ReceiptStructureService,
    MaterialMergeService,
    SpxAddressService,
  ],
})
export class AiModule {}
