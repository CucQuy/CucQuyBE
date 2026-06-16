import { Module } from '@nestjs/common';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { OrdersService } from '../orders/orders.service';
import { ExpensesService } from '../expenses/expenses.service';
import { TransactionsService } from '../transactions/transactions.service';
import { StockReceiptsService } from '../stock-receipts/stock-receipts.service';
import { CommissionService } from '../commission/commission.service';
import { PromotionsModule } from '../promotions/promotions.module';

/**
 * Báo cáo doanh thu (P&L). Tái dùng các service domain sẵn có — tất cả chỉ
 * phụ thuộc FirestoreService (global), nên cung cấp trực tiếp ở đây để khớp
 * 100% logic với các domain tương ứng.
 * OrdersService cần PromotionsService → import PromotionsModule (đã export service).
 */
@Module({
  imports: [PromotionsModule],
  controllers: [RevenueController],
  providers: [
    RevenueService,
    OrdersService,
    ExpensesService,
    TransactionsService,
    StockReceiptsService,
    CommissionService,
  ],
})
export class RevenueModule {}
