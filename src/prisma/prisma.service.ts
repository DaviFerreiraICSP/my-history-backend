import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    if (!process.env.DATABASE_URL) {
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      console.error('DATABASE_URL is missing in environment variables!');
      console.error('Please add it in Vercel Project Settings > Environment Variables.');
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    }
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    } as any);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  get client() {
    return this;
  }
}
