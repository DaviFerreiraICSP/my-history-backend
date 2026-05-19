import { Test, TestingModule } from '@nestjs/testing';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { GetNearbyDto } from './dto/get-nearby.dto';
import { GetStoryDto } from './dto/get-story.dto';

describe('HistoryController', () => {
  let controller: HistoryController;

  const mockHistoryService = {
    findNearby: jest.fn(),
    getStory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HistoryController],
      providers: [{ provide: HistoryService, useValue: mockHistoryService }],
    }).compile();

    controller = module.get<HistoryController>(HistoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getNearby', () => {
    it('should call historyService.findNearby with correct params', async () => {
      const dto: GetNearbyDto = { lat: -23.55, lon: -46.63 };
      mockHistoryService.findNearby.mockResolvedValueOnce([]);

      await controller.getNearby(dto);

      expect(mockHistoryService.findNearby).toHaveBeenCalledWith(
        dto.lat,
        dto.lon,
      );
    });
  });

  describe('getStory', () => {
    it('should call historyService.getStory with correct params', async () => {
      const dto: GetStoryDto = { name: 'Test Place', lat: 10, lon: 20 };
      mockHistoryService.getStory.mockResolvedValueOnce({ story: '...' });

      await controller.getStory(dto);

      expect(mockHistoryService.getStory).toHaveBeenCalledWith(
        dto.name,
        dto.lat,
        dto.lon,
      );
    });
  });
});
