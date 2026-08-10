import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/roles.decorator';
import { TtsService } from './tts.service';

/**
 * Loa thanh toán (audio TTS). PUBLIC + chỉ nhận SỐ TIỀN (không phải text tuỳ ý)
 * nên không thể bị lạm dụng làm proxy TTS chung. Dùng @Res() để trả thẳng MP3
 * (bypass envelope {data,...} toàn cục). FE phát bằng thẻ <audio>.
 */
@ApiTags('TTS')
@Controller('tts')
export class TtsController {
  constructor(private readonly service: TtsService) {}

  @Public()
  @Get('payment')
  @ApiQuery({ name: 'amount', required: true, description: 'Số tiền (VND)' })
  async payment(@Query('amount') amountRaw: string, @Res() res: Response): Promise<void> {
    const amount = Math.floor(Number(amountRaw));
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ success: false, error: 'amount không hợp lệ' });
      return;
    }

    try {
      const mp3 = await this.service.paymentAudio(amount);
      res.setHeader('Content-Type', 'audio/mpeg');
      // Cùng 1 số tiền → audio y hệt: cho phép cache lâu ở trình duyệt/CDN.
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(200).send(mp3);
    } catch {
      res.status(502).json({ success: false, error: 'TTS provider lỗi' });
    }
  }
}
