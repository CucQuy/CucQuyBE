import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/user.types';
import { OrdersService } from './orders.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { ReconcileRefundDto } from './dto/reconcile-refund.dto';
import { ReconcileTransactionDto } from './dto/reconcile-transaction.dto';
import { buildSpxFile, SpxAddressMode } from './spx/spx-export.util';

@ApiTags('Đơn hàng')
@Controller('orders')
@UseGuards(SsoAuthGuard)
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  /** Danh sách đơn hàng (đã enrich createdBy = tên hiển thị). */
  @Get()
  fetchOrders() {
    return this.service.fetchOrders();
  }

  /** Sinh số đơn kế tiếp. */
  @Get('next-number')
  async getNextOrderNumber() {
    return { orderNumber: await this.service.getNextOrderNumber() };
  }

  /** Toàn bộ phiếu hoàn (mọi đơn) — đối soát từ phía giao dịch tiền ra. */
  @Get('refunds')
  listRefunds() {
    return this.service.listRefunds();
  }

  /** Tra cứu LIVE hành trình vận đơn (SPX) theo mã — proxy tránh CORS. */
  @Get('tracking')
  fetchTracking(@Query('tn') tn: string) {
    return this.service.fetchTracking(tn || '');
  }

  /** Danh sách đơn PHÂN TRANG + lọc + sắp (server-side) → { items, total }. */
  @Get('page')
  listOrdersPage(@Query() query: Record<string, any>) {
    return this.service.listOrdersPage(query ?? {});
  }

  /** Đếm nhanh cho OrdersStats. */
  @Get('counts')
  orderCounts() {
    return this.service.orderCounts();
  }

  /** Danh mục hành chính CŨ (Tỉnh→Quận→Xã) cho dropdown sửa tay địa chỉ SPX. Khai báo TRƯỚC :id. */
  @Get('spx-old-catalog')
  getSpxOldCatalog() {
    return this.service.getSpxOldCatalog();
  }

  /** 1 đơn ĐẦY ĐỦ theo id (list trả bản nhẹ; chi tiết/sửa fetch cái này). */
  @Get(':id')
  getOrder(@Param('id') id: string) {
    return this.service.getOrder(id);
  }

  /** Refresh trạng thái VĐ (mốc mới nhất) cho các đơn SPX đang chạy → lưu DB, hiện ở list. */
  @Post('refresh-tracking')
  refreshTracking() {
    return this.service.refreshTracking();
  }

  /** Tạo đơn — trả order đã tạo (gồm id + orderNumber) để FE gửi Zalo. */
  @Post()
  addOrder(
    @Body() body: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addOrder(body, user);
  }

  /** Đổi TRẠNG THÁI đơn (nhẹ, nhanh) — chỉ status, không tính lại KM/items. */
  @Patch(':id/status')
  updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateOrderStatus(id, String(body?.status ?? ''), user);
  }

  /** Patch nhẹ field nhanh (paymentStatus/paymentMethod/deliveryType) — không tính lại KM/items. */
  @Patch(':id/fields')
  patchOrderFields(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.patchOrderFields(id, body ?? {}, user);
  }

  /** Đánh dấu đơn đã in bill cho khách (set bill_printed_at = now()). */
  @Patch(':id/print')
  markBillPrinted(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markBillPrinted(id, user);
  }

  /** Cập nhật đơn (check quyền CTV + ghi history). */
  @Patch(':id')
  updateOrder(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateOrder(id, body, user);
  }

  /** Xoá đơn — trả { id, prevOrder } để FE gửi Zalo delete notify. */
  @Delete(':id')
  deleteOrder(@Param('id') id: string) {
    return this.service.deleteOrder(id);
  }

  /**
   * Làm mịn địa chỉ SPX cho 1 đơn: resolve Tỉnh/Quận/Xã → lưu. Trả order đã cập nhật.
   * body.force=true (nút "Làm mịn lại") → luôn chạy; false/không (auto sau tạo/sửa) →
   * bỏ qua nếu user đã sửa tay hoặc địa chỉ chưa đổi.
   */
  @Post(':id/resolve-spx')
  resolveSpx(@Param('id') id: string, @Body() body: { force?: boolean }) {
    return this.service.resolveOrderSpx(id, body?.force === true);
  }

  /** Lưu địa chỉ SPX user chọn tay (dropdown Tỉnh/Quận/Xã) → set spx_manual=true. */
  @Patch(':id/spx-address')
  setSpxAddress(
    @Param('id') id: string,
    @Body() body: { state?: string; city?: string; ward?: string; detail?: string },
  ) {
    return this.service.setOrderSpxAddressManual(id, body ?? {});
  }

  /**
   * Tạo phiếu hoàn TAY theo hạng mục cho 1 đơn (đối soát tiền ra). Nếu body có
   * transactionId (GD tiền ra) → gắn + đối soát luôn. Trả order đầy đủ.
   */
  @Post(':id/refunds')
  createRefund(
    @Param('id') id: string,
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createRefund(id, dto, user);
  }

  /**
   * Đối soát 1 phiếu hoàn với 1 giao dịch SePay tiền ra (transfer_type='out').
   * Trả order đầy đủ (đã có field đối soát trong refunds) để FE refresh.
   */
  @Post(':id/refunds/:refundId/reconcile')
  reconcileRefund(
    @Param('refundId') refundId: string,
    @Body() dto: ReconcileRefundDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reconcileRefund(refundId, dto.transactionId, user);
  }

  /** Đánh dấu phiếu hoàn đã trả bằng tiền mặt (không gắn giao dịch SePay). */
  @Post(':id/refunds/:refundId/cash')
  markRefundCash(
    @Param('refundId') refundId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.markRefundCash(refundId, user);
  }

  /** Gỡ đối soát phiếu hoàn (về trạng thái chưa đối soát). */
  @Post(':id/refunds/:refundId/unreconcile')
  unreconcileRefund(
    @Param('refundId') refundId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.unreconcileRefund(refundId, user);
  }

  /**
   * Đối soát 1 giao dịch (tiền vào/ra) với đơn ngay từ form đơn:
   * in → cộng, out → trừ paidAmount rồi suy lại payment_status. Trả order đã cập nhật.
   */
  @Post(':id/reconcile-transaction')
  reconcileTransaction(
    @Param('id') id: string,
    @Body() dto: ReconcileTransactionDto,
  ) {
    return this.service.reconcileTransaction(id, dto.transactionId);
  }

  /** Đồng bộ vận đơn từ file 3PL (SPX/GHTK…). body: { rows:[{tracking,link,status,name,phone}], apply }. */
  @Post('sync-tracking')
  syncTracking(@Body() body: { rows?: Record<string, any>[]; apply?: boolean }) {
    return this.service.syncTracking(body?.rows ?? [], body?.apply ?? false);
  }

  /** Đồng bộ tiền thu hộ (COD) từ file ví SPX. body: { rows:[{txId,tracking,amount,date}], apply }. */
  @Post('sync-cod')
  syncCod(@Body() body: { rows?: Record<string, any>[]; apply?: boolean }) {
    return this.service.syncCod(body?.rows ?? [], body?.apply ?? false);
  }

  /**
   * Tạo file .xlsx tạo đơn hàng loạt SPX (mổ file nền đã upload-OK, nén DEFLATE <5MB).
   * body: { rows: (string|number)[][], addressMode: 'old'|'new' }. Trả file binary để FE tải.
   */
  @Post('spx-file')
  async spxFile(
    @Body() body: { rows?: (string | number)[][]; addressMode?: SpxAddressMode },
    @Res() res: Response,
  ): Promise<void> {
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    // Địa chỉ đơn là hệ MỚI (post-sáp-nhập) → mặc định điền sheet "địa chỉ mới".
    const mode: SpxAddressMode = body?.addressMode === 'old' ? 'old' : 'new';
    const buf = await buildSpxFile(rows, mode);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="SPX_TaoDon.xlsx"');
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }
}
