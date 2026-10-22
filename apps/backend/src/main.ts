import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createValidationPipe } from './common/pipes/validation.pipe.config';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggerInterceptor } from './common/interceptors/logger.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Injected by @averildwi/nest-common
  const config = app.get(ConfigService);

  // Behind a proxy, req.ip is the proxy unless we trust it. Trust the exact
  // hop count (TRUST_PROXY_HOPS), never `true`.
  app.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));
  app.setGlobalPrefix('api');

  // Empty FRONTEND_URL means no cross-origin access (never a wildcard).
  const allowedOrigins = config
    .getOrThrow<string>('FRONTEND_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(
    new LoggerInterceptor(),
    new TransformInterceptor(),
  );
  // Nest tries the LAST registered filter first, so the catch-all goes first.
  app.useGlobalFilters(
    new GlobalExceptionFilter(),
    new PrismaExceptionFilter(),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SIGAP!')
    .setDescription('API documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter the JWT token from the login response',
      },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
