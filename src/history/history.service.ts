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

      // Deduplicar por coordenadas exatas (artigos genéricos da Wikipedia usam coord da cidade)
      const seen = new Set<string>();
      const unique = places.filter((p: any) => {
        const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return unique.map((p: any) => ({
        id: String(p.pageid),
        name: this.cleanWikiTitle(p.title),
        lat: p.lat,
        lon: p.lon,
        type: this.inferTypeFromTitle(p.title),
      }));
    } catch (error) {
      this.logger.error('Wikipedia Geosearch Error', error.message);
      return this.findNearbyWikiData(lat, lon);
    }
  }

  private cleanWikiTitle(title: string): string {
    // Remove disambiguation parenthetical: "Praça da Sé (São Paulo)" → "Praça da Sé"
    return title.replace(/\s*\([^)]+\)\s*$/, '').trim();
  }

  private inferTypeFromTitle(title: string): string {
    const t = title.toLowerCase();
    if (/catedral|basílica|basilica|igreja|chapel|church|mosteiro|monastery/.test(t)) return 'church';
    if (/museu|museum|pinacoteca|galeria/.test(t)) return 'museum';
    if (/castelo|castle|forte|fort|fortaleza|cidadela/.test(t)) return 'castle';
    if (/memorial|cemitério|cemiterio/.test(t)) return 'memorial';
    if (/ruína|ruins|sítio arqueológico|archaeological/.test(t)) return 'ruins';
    if (/campo de batalha|battlefield/.test(t)) return 'battlefield';
    if (/palácio|palacio|palace/.test(t)) return 'monument';
    if (/praça|square|plaza|largo|jardim|parque/.test(t)) return 'monument';
    if (/monumento|monument|estátua|statue|obelisco/.test(t)) return 'monument';
    return 'historical_landmark';
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
    const headers = { 'User-Agent': 'OurHistoryApp/1.0 (contact@example.com)' };

    const fetchExact = async (lang: string) => {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=pageimages|info&piprop=original&inprop=url&titles=${encodeURIComponent(name)}&origin=*`;
      const res = await axios.get(url, { headers, timeout: 8000 });
      const page = res.data?.query?.pages?.[0];
      if (!page || page.missing) return null;
      return { photoUrl: page?.original?.source || null, wikiUrl: page?.fullurl || null };
    };

    try {
      // Prioriza pt.wikipedia.org (fonte dos nossos locais) com exact match
      const pt = await fetchExact('pt');
      if (pt?.wikiUrl) return pt;

      // Tenta en.wikipedia.org com exact match
      const en = await fetchExact('en');
      if (en?.wikiUrl) return en;

      // Sem resultado exato: retorna null em vez de busca fuzzy (evita foto/link errado)
      return { photoUrl: null, wikiUrl: null };
    } catch (error) {
      this.logger.warn(`Could not fetch wiki data for ${name}`, error.message);
      return { photoUrl: null, wikiUrl: null };
    }
  }
}
