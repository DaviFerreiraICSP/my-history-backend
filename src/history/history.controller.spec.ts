import { Test, TestingModule } from '@nestjs/testing';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { GetStoryDto } from './dto/get-story.dto';

describe('HistoryController', () => {
  let controller: HistoryController;

  const mockHistoryService = {
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

  describe('getStory', () => {
    it('should call historyService.getStory with correct params', async () => {
      const dto: GetStoryDto = { name: 'Test Place', lat: 10, lon: 20 };
      mockHistoryService.getStory.mockResolvedValueOnce({ story: '...' });

      await controller.getStory(dto);

      expect(mockHistoryService.getStory).toHaveBeenCalledWith(
        dto.name,
        dto.lat,
        dto.lon,
        'pt-BR',
        'historian',
      );
    });
  });
});
