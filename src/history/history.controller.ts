import { Controller, Get, Query } from '@nestjs/common';
import { HistoryService } from './history.service';
import { GetNearbyDto } from './dto/get-nearby.dto';
import { GetStoryDto } from './dto/get-story.dto';
@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('nearby')
  async getNearby(@Query() query: GetNearbyDto): Promise<any[]> {
    return this.historyService.findNearby(query.lat, query.lon, query.lang);
  }

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
