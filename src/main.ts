import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  const allowedOrigins = [
    'https://ourhistory.dev',
    'https://www.ourhistory.dev',
    'https://historyfrontend.vercel.app',
    'https://historyfrontend-daviferreiraicsps-projects.vercel.app',
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
  ];
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      const allowed = allowedOrigins.some(o =>
        typeof o === 'string' ? o === origin : o.test(origin)
      );
      callback(allowed ? null : new Error('Not allowed by CORS'), allowed);
    },
    methods: ['GET'],
    credentials: false,
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
