import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { IpThrottlerGuard } from '../../common/ip-throttler.guard';
import { OcrService } from './ocr.service';
import { VisionOcrDto } from './dto/vision-ocr.dto';

@ApiTags('OCR')
@Controller('ocr')
// OCR (Google Vision) tốn quota: 120 lần/phút/IP (đủ cho bulk import concurrency 3).
@Throttle({ default: { limit: 120, ttl: 60000 } })
@UseGuards(IpThrottlerGuard, SsoAuthGuard)
export class OcrController {
  constructor(private readonly service: OcrService) {}

  /** Trích xuất text từ ảnh base64 qua Google Vision. */
  @Post('vision')
  async vision(@Body() dto: VisionOcrDto) {
    const text = await this.service.extractText(dto.content);
    return { text };
  }
}
