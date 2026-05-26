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

const SEVEN_WONDERS = [
  { id: 'wonder_colosseum',       name: 'Coliseu',                 lat:  41.8902, lon:  12.4922,  type: 'wonder' },
  { id: 'wonder_great_wall',      name: 'Grande Muralha da China', lat:  40.4319, lon: 116.5704,  type: 'wonder' },
  { id: 'wonder_christ_redeemer', name: 'Cristo Redentor',         lat: -22.9519, lon: -43.2105,  type: 'wonder' },
  { id: 'wonder_machu_picchu',    name: 'Machu Picchu',            lat: -13.1631, lon: -72.5450,  type: 'wonder' },
  { id: 'wonder_chichen_itza',    name: 'Chichen Itzá',            lat:  20.6843, lon: -88.5678,  type: 'wonder' },
  { id: 'wonder_taj_mahal',       name: 'Taj Mahal',               lat:  27.1751, lon:  78.0421,  type: 'wonder' },
  { id: 'wonder_petra',           name: 'Petra',                   lat:  30.3285, lon:  35.4444,  type: 'wonder' },
  { id: 'wonder_pyramid_giza',    name: 'Pirâmides de Gizé',       lat:  29.9792, lon:  31.1342,  type: 'wonder' },
];

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

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private toWikiLang(appLang: string): string {
    const map: Record<string, string> = {
      'pt-BR': 'pt', 'es-ES': 'es', 'fr-FR': 'fr',
      'de-DE': 'de', 'zh-CN': 'zh', 'ja-JP': 'ja', 'ru-RU': 'ru',
    };
    return map[appLang] || 'en';
  }

  async findNearby(lat: number, lon: number, lang: string = 'en-US') {
    this.logger.log(`Finding nearby historical sites for ${lat}, ${lon} using Wikipedia Geosearch`);

    const wikiSearch = async (lang: string) => {
      const response = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
        params: {
          action: 'query',
          list: 'geosearch',
          gscoord: `${lat}|${lon}`,
          gsradius: 10000,
          gslimit: 50,
          format: 'json',
        },
        headers: { 'User-Agent': 'OurHistoryApp/1.0 (contact@example.com)' },
        timeout: 8000,
      });
      return response.data?.query?.geosearch || [];
    };

    try {
      // Sempre busca en (melhor cobertura global) + idioma local se diferente
      const localLang = this.toWikiLang(lang);
      const langList = localLang === 'en' ? ['en'] : ['en', localLang];
      const results = await Promise.all(langList.map(l => wikiSearch(l).catch(() => [])));
      const [enPlaces, ...rest] = results;
      const ptPlaces = rest[0] ?? [];

      // Deduplicar por pageid (mais confiável que coordenadas)
      const seen = new Set<number>();
      const unique = [...ptPlaces, ...enPlaces].filter((p: any) => {
        if (seen.has(p.pageid)) return false;
        seen.add(p.pageid);
        return true;
      });

      const wikiPlaces = unique.map((p: any) => ({
        id: String(p.pageid),
        name: this.cleanWikiTitle(p.title),
        lat: p.lat,
        lon: p.lon,
        type: this.inferTypeFromTitle(p.title),
      }));

      const nearbyWonders = SEVEN_WONDERS.filter(
        w => this.haversineKm(lat, lon, w.lat, w.lon) <= 50,
      );

      // Wonders first; remove any Wikipedia duplicate that matches a wonder name
      // Remove artigos Wikipedia cujas coordenadas estejam a menos de 500m de uma maravilha
      const wikiFiltered = wikiPlaces.filter(
        p => !nearbyWonders.some(
          w => this.haversineKm(p.lat, p.lon, w.lat, w.lon) < 0.5,
        ),
      );

      return [...nearbyWonders, ...wikiFiltered];
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
    if (/estação|station|terminal ferroviário|terminal rodoviário|metrô|metro|ferrovia/.test(t)) return 'station';
    if (/\bbairro\b|distrito|district|vila |vila$/.test(t)) return 'district';
    if (/universidade|university|faculdade|faculty|\bcollege\b|liceu|academia de/.test(t)) return 'university';
    if (/\bponte\b|\bbridge\b|viaduto|viaduct|aqueduto|aqueduct/.test(t)) return 'bridge';
    if (/teatro|theatre|theater|ópera|opera house|anfiteatro|amphith/.test(t)) return 'theater';
    if (/proclamação|proclamation|tratado de |declaração de independência|declaration of independence/.test(t)) return 'event_site';
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
      'university': 'Universidade Histórica',
      'bridge': 'Ponte Histórica',
      'theater': 'Teatro / Ópera',
      'wonder': 'Maravilha do Mundo',
      'event_site': 'Local de Evento Histórico',
    };
    return types[type] || 'Ponto de Interesse';
  }

  async getStory(name: string, lat: number, lon: number, lang: string = 'pt-BR', aiGuide: string = 'historian') {
    this.logger.log(`Getting story for ${name} in ${lang} with guide: ${aiGuide}`);

    // Busca Wikipedia primeiro — o extrato é usado como âncora factual no prompt
    const wikiData = await this.fetchWikiData(name);
    const storyText = await this.generateStoryContent(name, lat, lon, lang, aiGuide, wikiData.extract);

    return {
      story: storyText,
      photoUrl: wikiData.photoUrl,
      wikiUrl: wikiData.wikiUrl,
    };
  }

  private getPersonaInstruction(aiGuide: string): string {
    const personas: Record<string, string> = {
      historian: 'Você é um historiador apaixonado e especialista. Escreva com rigor factual, revelando curiosidades e contexto da época. Tom envolvente mas preciso, como um documentário de alto nível.',
      professor: 'Você é um professor de história didático e empolgante. Explique o contexto histórico de forma clara, use comparações com o presente e analogias simples. Tom de aula interessante que prende a atenção, acessível a qualquer pessoa.',
      child: 'Você é um contador de histórias para crianças de 6 a 10 anos. Use linguagem simples, frases curtas, palavras fáceis e uma pitada de aventura e magia. Fale como se contasse um conto de fadas histórico — deixe as crianças curiosas e animadas para aprender mais.',
    };
    return personas[aiGuide] || personas.historian;
  }

  private async generateStoryContent(name: string, lat: number, lon: number, lang: string, aiGuide: string, wikiExtract: string | null): Promise<string> {
    const personaInstruction = this.getPersonaInstruction(aiGuide);

    const groundingBlock = wikiExtract
      ? `\n\nCONTEXTO FACTUAL (fonte: Wikipedia — use como base obrigatória):\n"${wikiExtract}"\n\nRegras: use APENAS os fatos acima. Para datas ou nomes incertos, use "aproximadamente" ou "estima-se". Nunca invente eventos, personagens ou detalhes ausentes do contexto.`
      : `\n\nAVISO: Sem dados verificados para este local. Use linguagem cautelosa ("estima-se", "segundo registros", "possivelmente"). Nunca invente datas ou nomes com certeza.`;

    const prompt = `${personaInstruction}${groundingBlock}

Escreva exatamente 3 parágrafos sobre o local histórico "${name}" (coordenadas: ${lat}, ${lon}).
Inclua: origem e data aproximada, quem construiu ou por que é importante, e como chegou até hoje.
Responda no idioma: ${lang}.
Não use saudações, títulos ou introduções — comece direto a história.`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      this.logger.error('Gemini Generation Error', error);
      throw new InternalServerErrorException('Falha ao gerar narrativa com IA');
    }
  }

  private async fetchWikiData(name: string): Promise<{ photoUrl: string | null, wikiUrl: string | null, extract: string | null }> {
    const headers = { 'User-Agent': 'OurHistoryApp/1.0 (contact@example.com)' };

    const fetchCommonsPhoto = async (): Promise<string | null> => {
      const res = await axios.get('https://commons.wikimedia.org/w/api.php', {
        params: {
          action: 'query',
          generator: 'search',
          gsrsearch: name,
          gsrnamespace: 6,
          gsrlimit: 8,
          prop: 'imageinfo',
          iiprop: 'url|mime',
          iiurlwidth: 800,
          format: 'json',
          origin: '*',
        },
        headers,
        timeout: 8000,
      });
      const pages = Object.values(res.data?.query?.pages || {}) as any[];
      const photo = pages.find(p => {
        const mime: string = p.imageinfo?.[0]?.mime || '';
        return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
      });
      return photo?.imageinfo?.[0]?.thumburl || null;
    };

    const fetchWikiArticle = async (lang: string): Promise<{ wikiUrl: string | null, extract: string | null }> => {
      const res = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
        params: {
          action: 'query',
          format: 'json',
          formatversion: 2,
          prop: 'info|extracts',
          inprop: 'url',
          exintro: true,
          explaintext: true,
          exsentences: 6,
          titles: name,
          origin: '*',
        },
        headers,
        timeout: 8000,
      });
      const page = res.data?.query?.pages?.[0];
      if (!page || page.missing) return { wikiUrl: null, extract: null };
      return { wikiUrl: page.fullurl || null, extract: page.extract || null };
    };

    try {
      const [photoUrl, ptData, enData] = await Promise.all([
        fetchCommonsPhoto().catch(() => null),
        fetchWikiArticle('pt').catch(() => ({ wikiUrl: null, extract: null })),
        fetchWikiArticle('en').catch(() => ({ wikiUrl: null, extract: null })),
      ]);
      return {
        photoUrl,
        wikiUrl: ptData.wikiUrl || enData.wikiUrl,
        extract: enData.extract || ptData.extract,
      };
    } catch (error) {
      this.logger.warn(`Could not fetch wiki data for ${name}`, error.message);
      return { photoUrl: null, wikiUrl: null, extract: null };
    }
  }
}
