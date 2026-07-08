import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { TransactionsService } from './transactions.service';
import { MarkExternalDto } from './dto/mark-external.dto';
import { MarkSettledDto } from './dto/mark-settled.dto';
import { LinkOrderDto } from './dto/link-order.dto';
import { ReconcileApplyDto } from './dto/reconcile-apply.dto';

@ApiTags('Giao dịch')
@Controller('transactions')
@UseGuards(SsoAuthGuard)
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  /** Danh sách giao dịch (sắp theo ngày giảm dần). */
  @Get()
  fetchTransactions() {
    return this.service.fetchTransactions();
  }

  /** Giao dịch theo mã đơn (đối soát). */
  @Get('by-order')
  fetchByOrderNumber(@Query('orderNumber') orderNumber: string) {
    return this.service.fetchTransactionsByOrderNumber(orderNumber ?? '');
  }

  /** Giao dịch tiền RA chưa gắn phiếu hoàn — cho FE chọn khi đối soát hoàn tiền. */
  @Get('out-unlinked')
  fetchOutUnlinked() {
    return this.service.fetchOutUnlinked();
  }

  /** Đánh dấu / bỏ đánh dấu giao dịch ngoài hệ thống. */
  @Patch(':id/external')
  async markExternal(@Param('id') id: string, @Body() dto: MarkExternalDto) {
    await this.service.markTransactionExternal(id, dto.isExternal);
    return { ok: true };
  }

  /** Đánh dấu / bỏ: tiền RA đã kết toán (chuyển về TK chính). */
  @Patch(':id/settled')
  async markSettled(@Param('id') id: string, @Body() dto: MarkSettledDto) {
    await this.service.markTransactionSettled(id, dto.settled);
    return { ok: true };
  }

  /** Liên kết / gỡ liên kết giao dịch với đơn (orderNumber rỗng = gỡ). */
  @Patch(':id/link')
  async linkOrder(@Param('id') id: string, @Body() dto: LinkOrderDto) {
    await this.service.linkTransactionOrder(id, dto.orderNumber);
    return { ok: true };
  }

  /** Đối soát — preview (dry-run): các cặp GD↔đơn sẽ khớp tự động, KHÔNG ghi. */
  @Post('reconcile/preview')
  reconcilePreview() {
    return this.service.reconcilePreview();
  }

  /** Đối soát — apply: ghi map cho danh sách cặp user đã confirm (atomic, idempotent). */
  @Post('reconcile/apply')
  reconcileApply(@Body() dto: ReconcileApplyDto) {
    return this.service.reconcileApply(dto.pairs);
  }
}
