import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/roles.decorator';
import { PayrollClosingService } from './payroll-closing.service';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Tải bảng lương Excel qua LINK token (gửi cho NV qua Zalo). PUBLIC — NV bấm từ
 * Zalo không đăng nhập app; token đã ký + hết hạn nên không dò/giả mạo được.
 * Controller RIÊNG (path 'payroll') → KHÔNG dính SsoAuthGuard/NetworkGuard của
 * 'attendance' (NV bấm từ nhà, ngoài mạng quán vẫn tải được). File sinh TẠI CHỖ,
 * không lưu ở cloud/đĩa. @Res() để stream thẳng (bypass envelope {data} toàn cục).
 */
@ApiTags('Bảng lương')
@Controller('payroll')
export class PayrollDownloadController {
  constructor(private readonly closing: PayrollClosingService) {}

  @Public()
  @Get('download')
  @ApiQuery({ name: 'token', required: true })
  async download(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const out = token ? await this.closing.buildDownload(token) : null;
    if (!out) {
      res.status(404).send('Link không hợp lệ hoặc đã hết hạn.');
      return;
    }
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.filename}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(out.buffer);
  }
}
