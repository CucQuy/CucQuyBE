import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiParam, ApiQuery } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../auth/roles.decorator';
import { PayrollClosingService } from './payroll-closing.service';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Tải bảng lương Excel qua LINK token (gửi cho NV qua Zalo). PUBLIC — NV bấm từ
 * Zalo không đăng nhập app; token đã ký + hết hạn nên không dò/giả mạo được.
 * Controller RIÊNG (path 'payroll') → KHÔNG dính SsoAuthGuard/NetworkGuard của
 * 'attendance' (NV bấm từ nhà, ngoài mạng quán vẫn tải được). File sinh tại chỗ
 * rồi cache trong pod (ephemeral, không lên cloud) và trả bằng res.sendFile —
 * xem buildDownloadPath. @Res() để stream thẳng (bypass envelope {data} toàn cục).
 */
@ApiTags('Bảng lương')
@Controller('payroll')
export class PayrollDownloadController {
  private readonly logger = new Logger(PayrollDownloadController.name);

  constructor(private readonly closing: PayrollClosingService) {}

  /**
   * Dạng đường dẫn CÓ đuôi .xlsx — dùng cho file_url gửi qua Abit: Zalo nhận dạng
   * file theo đuôi URL, link kiểu `?token=` (không đuôi) làm Zalo báo "Có lỗi
   * trong quá trình tải File" khi NV bấm tải.
   */
  @Public()
  @Get('download/:file')
  @ApiParam({ name: 'file', description: '<token>.xlsx' })
  async downloadFile(
    @Param('file') file: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    await this.stream(String(file ?? '').replace(/\.xlsx$/i, ''), res, req);
  }

  /** Dạng query cũ — giữ để link đã gửi các kỳ trước vẫn tải được. */
  @Public()
  @Get('download')
  @ApiQuery({ name: 'token', required: true })
  async download(
    @Query('token') token: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    await this.stream(token, res, req);
  }

  private async stream(
    token: string,
    res: Response,
    req?: Request,
  ): Promise<void> {
    // Log ai tải + kết quả: Zalo KHÔNG giữ file trên server nó, client tự tải từ
    // url này, nên khi NV báo "không tải được file" phải soi được request thật.
    const t0 = Date.now();
    const who =
      `ua="${String(req?.headers['user-agent'] ?? '-')}" ` +
      `ip=${String(req?.headers['cf-connecting-ip'] ?? req?.ip ?? '-')} ` +
      `method=${String(req?.method ?? '-')} ` +
      `range=${String(req?.headers['range'] ?? '-')}`;

    const out = token ? await this.closing.buildDownloadPath(token) : null;
    if (!out) {
      this.logger.warn(`payroll download 404: ${who}`);
      res.status(404).send('Link không hợp lệ hoặc đã hết hạn.');
      return;
    }

    // sendFile (thư viện `send`) tự lo ETag/Last-Modified/Accept-Ranges/206 —
    // Zalo cần đúng hành vi của file tĩnh mới tải được, res.send(buffer) không đủ.
    this.logger.log(`payroll download ${out.filename} (${Date.now() - t0}ms): ${who}`);
    res.sendFile(out.path, {
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${out.filename}"`,
      },
      maxAge: 0,
      cacheControl: true,
    });
  }
}
