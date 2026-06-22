import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { bullConnection } from './queue/queue.constants';
import { FirebaseModule } from './firebase/firebase.module';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { HealthController } from './health/health.controller';
import { CommissionModule } from './modules/commission/commission.module';
import { ProductsModule } from './modules/products/products.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { BadgesModule } from './modules/badges/badges.module';
import { CommissionGroupsModule } from './modules/commission-groups/commission-groups.module';
import { ConfigurationsModule } from './modules/configurations/configurations.module';
import { UsersModule } from './modules/users/users.module';
import { OrdersModule } from './modules/orders/orders.module';
import { StockReceiptsModule } from './modules/stock-receipts/stock-receipts.module';
import { ImagesModule } from './modules/images/images.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { SerpapiModule } from './modules/serpapi/serpapi.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { GeminiModule } from './modules/gemini/gemini.module';
import { ZaloModule } from './modules/zalo/zalo.module';
import { RevenueModule } from './modules/revenue/revenue.module';
import { RequestLogsModule } from './modules/request-logs/request-logs.module';
import { LoggingMiddleware } from './modules/request-logs/logging.middleware';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { SurchargeTagsModule } from './modules/surcharge-tags/surcharge-tags.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    FirebaseModule,
    DbModule,
    RedisModule,
    // BullMQ — hàng đợi job (gửi Zalo, xử webhook) chạy nền + retry. Dùng Redis.
    BullModule.forRoot({
      connection: bullConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    }),
    CommissionModule,
    ProductsModule,
    CustomersModule,
    TransactionsModule,
    CategoriesModule,
    BadgesModule,
    CommissionGroupsModule,
    ConfigurationsModule,
    UsersModule,
    OrdersModule,
    StockReceiptsModule,
    ImagesModule,
    WebhooksModule,
    SerpapiModule,
    OcrModule,
    GeminiModule,
    ZaloModule,
    RevenueModule,
    RequestLogsModule,
    PromotionsModule,
    SurchargeTagsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  // Áp LoggingMiddleware cho mọi route → ghi nhật ký request.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
