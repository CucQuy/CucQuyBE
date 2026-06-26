import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../../auth/firebase-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/user.types';
import { OrdersService } from './orders.service';
import { ReconcileRefundDto } from './dto/reconcile-refund.dto';

@ApiTags('Đơn hàng')
@Controller('orders')
@UseGuards(FirebaseAuthGuard)
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

  /** Tạo đơn — trả order đã tạo (gồm id + orderNumber) để FE gửi Zalo. */
  @Post()
  addOrder(
    @Body() body: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addOrder(body, user);
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
}
