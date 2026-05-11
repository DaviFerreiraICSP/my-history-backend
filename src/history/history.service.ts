import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async findNearby(lat: number, lon: number) {
    this.logger.log(`Finding nearby historical sites for ${lat}, ${lon}`);
    const radius = 1000; // 1km
    const query = `
      [out:json];
      (
        node(around:${radius}, ${lat}, ${lon})[historic];
        way(around:${radius}, ${lat}, ${lon})[historic];
        relation(around:${radius}, ${lat}, ${lon})[historic];
      );
      out center;
    `;

    try {
      const response = await axios.post('https://overpass-api.de/api/interpreter', query);
      const elements = response.data.elements;

      return elements.map((el) => ({
        id: el.id,
        name: el.tags.name || el.tags.historic || 'Local Histórico Desconhecido',
        lat: el.lat || el.center.lat,
        lon: el.lon || el.center.lon,
        type: el.tags.historic,
      })).filter(el => el.name !== 'Local Histórico Desconhecido');
    } catch (error) {
      this.logger.error('Error fetching from Overpass API', error);
      return [];
    }
  }

  async getStory(name: string, lat: number, lon: number) {
    this.logger.log(`Getting story for ${name}`);

    // Check cache
    const cachedStory = await this.prisma.locationStory.findUnique({
      where: { name },
    });

    if (cachedStory) {
      this.logger.log(`Returning cached story for ${name}`);
      return cachedStory;
    }

    // Generate new story
    this.logger.log(`Generating new story for ${name} via Gemini`);
    const promptTemplate = fs.readFileSync(
      path.join(process.cwd(), '..', 'history_ai_config_', 'master_prompt.txt'),
      'utf-8',
    );

    const prompt = promptTemplate
      .replace('{{PLACE_NAME}}', name)
      .replace('{{LAT}}', lat.toString())
      .replace('{{LON}}', lon.toString());

    try {
      const result = await this.model.generateContent(prompt);
      const storyText = result.response.text();

      const newStory = await this.prisma.locationStory.create({
        data: {
          name,
          latitude: lat,
          longitude: lon,
          story: storyText,
        },
      });

      return newStory;
    } catch (error) {
      this.logger.error('Error generating story with Gemini', error);
      throw error;
    }
  }
}
