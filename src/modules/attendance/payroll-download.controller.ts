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
 * Đọc header `Range: bytes=...` (chỉ 1 khoảng — đủ cho mọi client tải file).
 * Trả null = không có/không hiểu (gửi cả file), 'invalid' = vượt kích thước (416).
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (!rawStart && !rawEnd) return 'invalid';
  let start: number;
  let end: number;
  if (!rawStart) {
    // 'bytes=-500' → 500 byte cuối
    const suffix = Number(rawEnd);
    if (suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  if (start >= size || start > end) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

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
    const out = token ? await this.closing.buildDownload(token) : null;
    if (!out) {
      this.logger.warn(`payroll download 404: ${who}`);
      res.status(404).send('Link không hợp lệ hoặc đã hết hạn.');
      return;
    }
    const total = out.buffer.length;
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.filename}"`,
    );
    // Zalo tải file theo từng chunk: không có Accept-Ranges + 206 thì nó coi như
    // tải thất bại ("nội dung không có trên máy chủ Zalo"). res.send() cũ bỏ qua
    // Range nên phải tự cắt buffer. Cache: cho client giữ, không cho proxy chung.
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    const range = parseRange(req?.headers['range'], total);
    if (range === 'invalid') {
      this.logger.warn(`payroll download 416: ${who}`);
      res.setHeader('Content-Range', `bytes */${total}`);
      res.status(416).end();
      return;
    }
    if (range) {
      const part = out.buffer.subarray(range.start, range.end + 1);
      this.logger.log(
        `payroll download 206 (${part.length}/${total}B, ${Date.now() - t0}ms): ${who}`,
      );
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
      res.setHeader('Content-Length', String(part.length));
      res.status(206).end(part);
      return;
    }
    this.logger.log(
      `payroll download 200 (${total}B, ${Date.now() - t0}ms): ${who}`,
    );
    res.setHeader('Content-Length', String(total));
    res.status(200).end(out.buffer);
  }
}
