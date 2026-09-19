import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { TransformInterceptor } from './common/transform.interceptor';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const config = loadConfig();
  // Tự cấu hình body-parser (tắt mặc định 100kb) để nhận ảnh bill base64 (vài MB).
  const app = await NestFactory.create(AppModule, { bufferLogs: false, bodyParser: false });
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // Sau nginx reverse proxy: tin X-Forwarded-For để req.ip ra IP thật của client
  // (không phải IP của nginx). Cần cho hệ thống nhật ký request.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.enableCors({
    origin: config.allowedOrigins.length ? config.allowedOrigins : true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  app.setGlobalPrefix('api');

  // Swagger UI — http://localhost:<port>/api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('CucQuy Bakery API')
    .setDescription('Backend NestJS — Postgres. Hầu hết endpoint cần SSO JWT (RiceService, Bearer).')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'SSO JWT (RiceService)' },
      'sso',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Áp Bearer cho mọi route (nhập token 1 lần ở nút Authorize là gọi được hết)
  document.security = [{ sso: [] }];
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(config.port);
  Logger.log(`🚀 CucQuyBakery API chạy tại :${config.port}/api`, 'Bootstrap');
  Logger.log(`📖 Swagger UI: :${config.port}/api/docs`, 'Bootstrap');
}
bootstrap();
