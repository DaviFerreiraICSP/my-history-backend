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
    it('should return historical places from Wikipedia Geosearch', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          query: {
            geosearch: [
              {
                pageid: 123456,
                title: 'Catedral Metropolitana de São Paulo',
                lat: -23.55,
                lon: -46.63,
                dist: 144.6,
              },
            ],
          },
        },
      });

      const result = await service.findNearby(-23.55, -46.63);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Catedral Metropolitana de São Paulo');
      expect(result[0].type).toBe('church');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockedAxios.get).toHaveBeenCalled();
    });

    it('should fall back to WikiData when Wikipedia Geosearch fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network Error'));
      mockedAxios.get.mockRejectedValueOnce(new Error('WikiData also down'));

      await expect(async () => service.findNearby(0, 0)).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('getStory', () => {
    it('should generate and return story with wiki data', async () => {
      const mockModel = {
        generateContent: jest.fn().mockResolvedValueOnce({
          response: { text: () => 'História gerada pela IA' },
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (service as any).model = mockModel;

      mockedAxios.get.mockResolvedValueOnce({
        data: { query: { pages: [{ fullurl: 'https://pt.wikipedia.org/wiki/Test', original: { source: 'https://foto.jpg' } }] } },
      });

      const result = await service.getStory('Test Place', 0, 0, 'pt-BR');

      expect(result.story).toBe('História gerada pela IA');
      expect(result.wikiUrl).toContain('wikipedia');
    });

    it('should throw InternalServerErrorException when Gemini fails', async () => {
      const mockModel = {
        generateContent: jest.fn().mockRejectedValueOnce(new Error('AI Failed')),
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (service as any).model = mockModel;

      mockedAxios.get.mockResolvedValueOnce({
        data: { query: { pages: [{ missing: true }] } },
      });

      await expect(async () =>
        service.getStory('Fail Place', 0, 0),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
