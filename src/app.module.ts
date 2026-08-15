import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { bullConnection } from './queue/queue.constants';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { MqttModule } from './mqtt/mqtt.module';
import { HealthController } from './health/health.controller';
import { SsoLoginController } from './auth/sso-login.controller';
import { CommissionModule } from './modules/commission/commission.module';
import { ProductsModule } from './modules/products/products.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { AssetsModule } from './modules/assets/assets.module';
import { ManualExpensesModule } from './modules/manual-expenses/manual-expenses.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { FlavorsModule } from './modules/flavors/flavors.module';
import { BadgesModule } from './modules/badges/badges.module';
import { CoachesModule } from './modules/coaches/coaches.module';
import { CommissionGroupsModule } from './modules/commission-groups/commission-groups.module';
import { ConfigurationsModule } from './modules/configurations/configurations.module';
import { UsersModule } from './modules/users/users.module';
import { OrdersModule } from './modules/orders/orders.module';
import { StockReceiptsModule } from './modules/stock-receipts/stock-receipts.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { WagesModule } from './modules/wages/wages.module';
import { ImagesModule } from './modules/images/images.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { SerpapiModule } from './modules/serpapi/serpapi.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { AiModule } from './modules/ai/ai.module';
import { ZaloModule } from './modules/zalo/zalo.module';
import { RevenueModule } from './modules/revenue/revenue.module';
import { RequestLogsModule } from './modules/request-logs/request-logs.module';
import { LoggingMiddleware } from './modules/request-logs/logging.middleware';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { SurchargeTagsModule } from './modules/surcharge-tags/surcharge-tags.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PosModule } from './modules/pos/pos.module';
import { NotificationSchedulesModule } from './modules/notification-schedules/notification-schedules.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { TtsModule } from './modules/tts/tts.module';
import { DineInModule } from './modules/dine-in/dine-in.module';
import { RecipesModule } from './modules/recipes/recipes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    RedisModule,
    MqttModule,
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
    AssetsModule,
    ManualExpensesModule,
    CategoriesModule,
    FlavorsModule,
    BadgesModule,
    CoachesModule,
    CommissionGroupsModule,
    ConfigurationsModule,
    UsersModule,
    OrdersModule,
    StockReceiptsModule,
    EmployeesModule,
    AttendanceModule,
    ShiftsModule,
    CalendarModule,
    DineInModule,
    WagesModule,
    ImagesModule,
    WebhooksModule,
    SerpapiModule,
    OcrModule,
    AiModule,
    ZaloModule,
    RevenueModule,
    RequestLogsModule,
    PromotionsModule,
    SurchargeTagsModule,
    NotificationsModule,
    PosModule,
    NotificationSchedulesModule,
    ShippingModule,
    TtsModule,
    RecipesModule,
  ],
  controllers: [HealthController, SsoLoginController],
})
export class AppModule implements NestModule {
  // Áp LoggingMiddleware cho mọi route → ghi nhật ký request.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
