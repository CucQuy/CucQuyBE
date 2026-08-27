import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { TransactionsService } from './transactions.service';
import { MarkExternalDto } from './dto/mark-external.dto';
import { MarkSettledDto } from './dto/mark-settled.dto';
import { LinkOrderDto } from './dto/link-order.dto';
import { ReconcileApplyDto } from './dto/reconcile-apply.dto';
import { ExpenseReconcileApplyDto } from './dto/expense-reconcile-apply.dto';
import { ExpenseLinkDto } from './dto/expense-link.dto';
import { SetExpenseDto } from './dto/set-expense.dto';
import { SaveExpenseRulesDto } from './dto/expense-rules.dto';
import { TxReceiptAllocAddDto } from './dto/receipt-alloc.dto';
import { CreateShippingDto } from './dto/create-shipping.dto';

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

  /** Sổ giao dịch thống nhất: list phân trang + total + summary (thu+chi 1 sổ). */
  @Get('ledger')
  fetchLedger(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('gateway') gateway?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.fetchLedger({
      from: from || null,
      to: to || null,
      type: type || null,
      status: status || null,
      category: category || null,
      gateway: gateway || null,
      search: search || null,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** Chuỗi thu/chi theo ngày trong kỳ (biểu đồ sổ). */
  @Get('ledger/series')
  fetchLedgerSeries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.fetchLedgerSeries(from || null, to || null);
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

  /** Danh sách rule phân loại chi phí (nội dung CK → category). */
  @Get('expense-rules')
  fetchExpenseRules() {
    return this.service.fetchExpenseRules();
  }

  /** Thay toàn bộ rule phân loại chi phí. */
  @Put('expense-rules')
  saveExpenseRules(@Body() dto: SaveExpenseRulesDto) {
    return this.service.saveExpenseRules(dto.items);
  }

  /** Auto phân loại bank-out theo rule; trả số bản ghi đã gán. */
  @Post('expense/apply-rules')
  applyExpenseRules() {
    return this.service.applyExpenseRules();
  }

  /** Tổng hợp OPEX theo category trong kỳ (pie/tổng quan chi phí). */
  @Get('expense-summary')
  fetchExpenseSummary(@Query('from') from: string, @Query('to') to: string) {
    return this.service.fetchExpenseSummary(from ?? '', to ?? '');
  }

  /** Bank-out trong kỳ (kèm phân loại) — màn Chi phí vận hành. */
  @Get('expense-out')
  fetchExpenseOut(@Query('from') from: string, @Query('to') to: string) {
    return this.service.fetchExpenseOut(from ?? '', to ?? '');
  }

  /** Set tay phân loại chi phí cho 1 giao dịch (category + cờ loại khỏi chi phí). */
  @Patch(':id/expense')
  async setExpense(@Param('id') id: string, @Body() dto: SetExpenseDto) {
    await this.service.setTransactionExpense(id, dto.category ?? null, dto.excluded, dto.note ?? null);
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

  /** Đối soát CHI PHÍ — preview (dry-run): cặp tiền-ra ↔ chi phí tay sẽ khớp, KHÔNG ghi. */
  @Post('expense-reconcile/preview')
  expenseReconcilePreview() {
    return this.service.expenseReconcilePreview();
  }

  /** Đối soát CHI PHÍ — apply: gắn danh sách cặp đã confirm (atomic, idempotent). */
  @Post('expense-reconcile/apply')
  expenseReconcileApply(@Body() dto: ExpenseReconcileApplyDto) {
    return this.service.expenseReconcileApply(dto.pairs);
  }

  /** Khớp tay 1 GD tiền-ra với 1 khoản chi phí có sẵn. */
  @Post(':id/expense-link')
  expenseLink(@Param('id') id: string, @Body() dto: ExpenseLinkDto) {
    return this.service.expenseLink(id, dto.expenseId);
  }

  /** Bỏ khớp khoản chi khỏi 1 GD tiền-ra (tiền ra quay lại tính OPEX auto). */
  @Delete(':id/expense-link')
  expenseUnlink(@Param('id') id: string) {
    return this.service.expenseUnlink(id);
  }

  /** Transaction-first: summary rải 1 GD tiền-ra ↔ nhiều phiếu nhập (đã gắn + phiếu ứng viên). */
  @Get(':id/receipt-allocations')
  fetchReceiptAllocations(@Param('id') id: string) {
    return this.service.fetchReceiptAllocations(id);
  }

  /** Rải 1 GD tiền-ra vào NHIỀU phiếu nhập 1 lượt (items = [{receiptId, amount?}]). */
  @Post(':id/receipt-allocations')
  addReceiptAllocations(@Param('id') id: string, @Body() dto: TxReceiptAllocAddDto) {
    return this.service.addReceiptAllocations(id, dto.items);
  }

  /** Gỡ 1 phân bổ GD↔phiếu (theo alloc id) → trả summary GD mới. */
  @Delete('receipt-allocations/:allocId')
  removeReceiptAllocation(@Param('allocId') allocId: string) {
    return this.service.removeReceiptAllocation(allocId);
  }

  /** Ứng viên ĐƠN cho 1 GD tiền vào (đối soát tay chặt: số tiền = tổng/còn thiếu/cọc, ~10 ngày). */
  @Get(':id/in-candidate-orders')
  fetchInCandidateOrders(@Param('id') id: string) {
    return this.service.fetchInCandidateOrders(id);
  }

  /** Link thanh toán ship hiện tại của 1 GD tiền ra (hoặc null). */
  @Get(':id/shipping')
  fetchShipping(@Param('id') id: string) {
    return this.service.fetchShipping(id);
  }

  /** Gắn ship (đơn / nhà xe) cho 1 GD tiền ra. */
  @Post(':id/shipping')
  createShipping(@Param('id') id: string, @Body() dto: CreateShippingDto) {
    return this.service.createShipping(id, dto);
  }

  /** Gỡ ship khỏi 1 GD tiền ra (về "chưa khớp"). */
  @Delete(':id/shipping')
  unlinkShipping(@Param('id') id: string) {
    return this.service.unlinkShipping(id);
  }
}
