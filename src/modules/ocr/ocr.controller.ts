import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { OcrService } from './ocr.service';
import { VisionOcrDto } from './dto/vision-ocr.dto';

@ApiTags('OCR')
@Controller('ocr')
@UseGuards(SsoAuthGuard)
export class OcrController {
  constructor(private readonly service: OcrService) {}

  /** Trích xuất text từ ảnh base64 qua Google Vision. */
  @Post('vision')
  async vision(@Body() dto: VisionOcrDto) {
    const text = await this.service.extractText(dto.content);
    return { text };
  }
}
