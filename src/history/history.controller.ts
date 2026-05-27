import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HistoryService } from './history.service';
import { GetStoryDto } from './dto/get-story.dto';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  // Stricter limit on the AI endpoint: max 3 stories per 10s, 10 per minute
  @Throttle({ short: { ttl: 10000, limit: 3 }, long: { ttl: 60000, limit: 10 } })
  @Get('story')
  async getStory(@Query() query: GetStoryDto): Promise<any> {
    return this.historyService.getStory(
      query.name,
      query.lat ?? 0,
      query.lon ?? 0,
      query.lang || 'pt-BR',
      query.aiGuide || 'historian',
    );
  }
}
