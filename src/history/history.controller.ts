import { Controller, Get, Query, ParseFloatPipe } from '@nestjs/common';
import { HistoryService } from './history.service';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('nearby')
  async getNearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
  ) {
    return this.historyService.findNearby(lat, lon);
  }

  @Get('story')
  async getStory(
    @Query('name') name: string,
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
  ) {
    return this.historyService.getStory(name, lat, lon);
  }
}
