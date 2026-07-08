import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { GeminiService } from './gemini.service';

@ApiTags('Gemini')
@Controller('gemini')
@UseGuards(SsoAuthGuard)
export class GeminiController {
  constructor(private readonly service: GeminiService) {}

  /** Kiểm tra OCR text có phải bill mua/bán hàng không. */
  @Post('validate-receipt')
  validateReceipt(@Body('ocrText') ocrText: string) {
    return this.service.validateReceipt(ocrText ?? '');
  }

  /** Cấu trúc hoá OCR text thành phiếu nhập hàng. */
  @Post('structure-receipt')
  structureReceipt(@Body('ocrText') ocrText: string) {
    return this.service.structureStockReceipt(ocrText ?? '');
  }
}
