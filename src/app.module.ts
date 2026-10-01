import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HistoryModule } from './history/history.module';
import { PrismaModule } from './prisma/prisma.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 10000,  // 10s — burst protection
        limit: 5,
      },
      {
        name: 'long',
        ttl: 60000,  // 1min — sustained limit
        limit: 30,
      },
    ]),
    HistoryModule,
    PrismaModule,
    FeedbackModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
