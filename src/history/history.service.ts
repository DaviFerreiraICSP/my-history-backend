import {
  Injectable,
  Logger,
  BadGatewayException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface OverpassElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: {
    name?: string;
    historic?: string;
    heritage?: string;
    tourism?: string;
    [key: string]: string | undefined;
  };
}

interface OverpassResponse {
  elements: OverpassElement[];
}

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.error(
        'GEMINI_API_KEY is not defined in environment variables',
      );
    }
    this.genAI = new GoogleGenerativeAI(apiKey || '');
    // Atualizado para Gemini 3.1 Flash Lite (o modelo padrão estável em Maio de 2026)
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });
  }

  async findNearby(lat: number, lon: number) {
    this.logger.log(`Finding nearby historical sites for ${lat}, ${lon} using Wikipedia Geosearch`);

    const wikiSearch = async (lang: string) => {
      const response = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
        params: {
          action: 'query',
          list: 'geosearch',
          gscoord: `${lat}|${lon}`,
          gsradius: 3000,
          gslimit: 20,
          format: 'json',
        },
        headers: { 'User-Agent': 'OurHistoryApp/1.0 (contact@example.com)' },
        timeout: 12000,
      });
      return response.data?.query?.geosearch || [];
    };

    try {
      let places = await wikiSearch('pt');
      if (places.length === 0) {
        places = await wikiSearch('en');
      }

      return places.map((p: any) => ({
        id: String(p.pageid),
        name: p.title,
        lat: p.lat,
        lon: p.lon,
        type: 'historical_landmark',
      }));
    } catch (error) {
      this.logger.error('Wikipedia Geosearch Error', error.message);
      return this.findNearbyWikiData(lat, lon);
    }
  }

  private async findNearbyWikiData(lat: number, lon: number) {
    this.logger.log('Falling back to WikiData...');
    const sparqlQuery = `
      SELECT ?place ?placeLabel ?location ?instanceLabel WHERE {
        SERVICE wikibase:around {
          ?place wdt:P625 ?location .
          bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
          bd:serviceParam wikibase:radius "2" .
        }
        ?place wdt:P31 ?instance .
        VALUES ?instance { wd:q4989906 wd:q500362 wd:q108113 wd:q83474 wd:q23413 wd:q41176 wd:q174782 wd:q928830 }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],pt-br,en". }
      } LIMIT 20
    `;
    try {
      const response = await axios.get('https://query.wikidata.org/sparql', {
        params: { query: sparqlQuery, format: 'json' },
        headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'ChronosPathApp/1.0' }
      });
      return (response.data.results?.bindings || []).map((b: any) => {
        const locationMatch = b.location.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
        return {
          id: b.place.value.split('/').pop(),
          name: b.placeLabel.value,
          lat: locationMatch ? parseFloat(locationMatch[2]) : 0,
          lon: locationMatch ? parseFloat(locationMatch[1]) : 0,
          type: b.instanceLabel.value
        };
      });
    } catch (e) {
      throw new BadGatewayException('Todas as fontes de dados falharam');
    }
  }

  private formatTypeName(type: string): string {
    const types: Record<string, string> = {
      'monument': 'Monumento Histórico',
      'castle': 'Castelo/Fortaleza',
      'ruins': 'Ruínas Antigas',
      'archaeological_site': 'Sítio Arqueológico',
      'memorial': 'Memorial',
      'battlefield': 'Campo de Batalha',
      'fort': 'Forte Histórico',
      'museum': 'Museu',
      'church': 'Igreja Histórica',
    };
    return types[type] || 'Ponto de Interesse';
  }

  async getStory(name: string, lat: number, lon: number, lang: string = 'pt-BR') {
    this.logger.log(`Getting story for ${name} in ${lang}`);

    const cacheKey = `${name}_${lang}`;

    // Check cache
    const cachedStory = await this.prisma.locationStory.findUnique({
      where: { name: cacheKey },
    });

    if (cachedStory) {
      this.logger.log(`Returning cached story for ${cacheKey}`);
      return cachedStory;
    }

    // Generate new story and fetch wiki data in parallel
    this.logger.log(`Generating new story and fetching wiki data for ${name} in ${lang}`);

    const [storyText, wikiData] = await Promise.all([
      this.generateStoryContent(name, lat, lon, lang),
      this.fetchWikiData(name)
    ]);

    try {
      const newStory = await this.prisma.locationStory.create({
        data: {
          name: cacheKey,
          latitude: lat,
          longitude: lon,
          story: storyText,
          photoUrl: wikiData.photoUrl,
          wikiUrl: wikiData.wikiUrl,
        },
      });

      return newStory;
    } catch (error) {
      this.logger.error('Error saving story to database', error);
      throw new InternalServerErrorException('Falha ao salvar crônica histórica');
    }
  }

  private async generateStoryContent(name: string, lat: number, lon: number, lang: string): Promise<string> {
    let promptTemplate = '';
    try {
      const configPath = path.resolve(process.cwd(), '..', 'history_ai_config_', 'master_prompt.txt');
      promptTemplate = fs.readFileSync(configPath, 'utf-8');
    } catch (e) {
      promptTemplate = 'Aja como um guia turístico historiador especializado. Escreva uma crônica detalhada (3-4 parágrafos) sobre o local: {{PLACE_NAME}}. Fale diretamente com o leitor no idioma: {{LANGUAGE}}. Inclua fatos históricos e curiosidades.';
    }

    const prompt = promptTemplate
      .replace('{{PLACE_NAME}}', name)
      .replace('{{LAT}}', lat.toString())
      .replace('{{LON}}', lon.toString())
      .replace('{{LANGUAGE}}', lang);

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      this.logger.error('Gemini Generation Error', error);
      throw new InternalServerErrorException('Falha ao gerar narrativa com IA');
    }
  }

  private async fetchWikiData(name: string): Promise<{ photoUrl: string | null, wikiUrl: string | null }> {
    try {
      const headers = {
        'User-Agent': 'ChronosPathApp/1.0 (contact@example.com) Axios/1.16.0'
      };

      // 1. Tenta buscar dados pelo título exato
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=pageimages|info|pageterms&piprop=original&inprop=url&titles=${encodeURIComponent(name)}&origin=*`;
      const response = await axios.get(url, { headers });
      
      let page = response.data?.query?.pages?.[0];
      
      // 2. Se não encontrar, tenta uma busca geral
      if (!page || page.missing) {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=1&prop=pageimages|info&piprop=original&inprop=url&origin=*`;
        const searchResponse = await axios.get(searchUrl, { headers });
        page = searchResponse.data?.query?.pages?.[0];
      }
      
      return {
        photoUrl: page?.original?.source || null,
        wikiUrl: page?.fullurl || null
      };
    } catch (error) {
      this.logger.warn(`Could not fetch wiki data for ${name}`, error.message);
      return { photoUrl: null, wikiUrl: null };
    }
  }
}
