import { Controller, Get, Query } from '@nestjs/common';
import { HistoryService } from './history.service';
import { GetNearbyDto } from './dto/get-nearby.dto';
import { GetStoryDto } from './dto/get-story.dto';
import { LocationStory } from '@prisma/client';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('nearby')
  async getNearby(@Query() query: GetNearbyDto): Promise<any[]> {
    return this.historyService.findNearby(query.lat, query.lon);
  }

  @Get('story')
  async getStory(@Query() query: GetStoryDto): Promise<LocationStory> {
    return this.historyService.getStory(
      query.name,
      query.lat ?? 0,
      query.lon ?? 0,
      query.lang || 'pt-BR',
    );
  }
}
