import { Test, TestingModule } from '@nestjs/testing';
import { HistoryService } from './history.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  BadGatewayException,
  InternalServerErrorException,
} from '@nestjs/common';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HistoryService', () => {
  let service: HistoryService;

  const mockPrismaService = {
    locationStory: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('mock-api-key'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoryService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<HistoryService>(HistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findNearby', () => {
    it('should return historical places from Overpass API', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          elements: [
            {
              type: 'node',
              id: 1180813951,
              lat: -23.55,
              lon: -46.63,
              tags: { historic: 'monument', name: 'Monumento 1' },
            },
          ],
        },
      });

      const result = await service.findNearby(-23.55, -46.63);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Monumento 1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('should throw BadGatewayException when Overpass API fails', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('API Down'));

      await expect(async () => service.findNearby(0, 0)).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('getStory', () => {
    it('should return cached story if available', async () => {
      const mockStory = {
        id: '1',
        name: 'Test Place',
        story: 'Cached Story',
        latitude: 0,
        longitude: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrismaService.locationStory.findUnique.mockResolvedValueOnce(
        mockStory,
      );

      const result = await service.getStory('Test Place', 0, 0);

      expect(result).toBe(mockStory);
      expect(mockPrismaService.locationStory.findUnique).toHaveBeenCalledWith({
        where: { name: 'Test Place_pt-BR' },
      });
    });

    it('should generate and save new story if not in cache', async () => {
      mockPrismaService.locationStory.findUnique.mockResolvedValueOnce(null);

      const mockModel = {
        generateContent: jest.fn().mockResolvedValueOnce({
          response: { text: () => 'New AI Story' },
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (service as any).model = mockModel;

      const mockCreatedStory = {
        id: '2',
        name: 'New Place',
        story: 'New AI Story',
        latitude: 1,
        longitude: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrismaService.locationStory.create.mockResolvedValueOnce(
        mockCreatedStory,
      );

      const result = await service.getStory('New Place', 1, 2);

      expect(result).toBe(mockCreatedStory);
      expect(mockPrismaService.locationStory.create).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when Gemini fails', async () => {
      mockPrismaService.locationStory.findUnique.mockResolvedValueOnce(null);
      const mockModel = {
        generateContent: jest
          .fn()
          .mockRejectedValueOnce(new Error('AI Failed')),
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (service as any).model = mockModel;

      await expect(async () =>
        service.getStory('Fail Place', 0, 0),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
