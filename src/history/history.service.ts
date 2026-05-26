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
    if (/estação|station|terminal ferroviário|terminal rodoviário|metrô|metro|ferrovia/.test(t)) return 'station';
    if (/\bbairro\b|distrito|district|vila |vila$/.test(t)) return 'district';
    if (/universidade|university|faculdade|faculty|\bcollege\b|liceu|academia de/.test(t)) return 'university';
    if (/\bponte\b|\bbridge\b|viaduto|viaduct|aqueduto|aqueduct/.test(t)) return 'bridge';
    if (/teatro|theatre|theater|ópera|opera house|anfiteatro|amphith/.test(t)) return 'theater';
    if (/coliseu|colosseum|acrópole|acropolis|pirâmide|pyramid|taj mahal|machu picchu|angkor|grande muralha|maravilha do mundo/.test(t)) return 'wonder';
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

    const [storyText, wikiData] = await Promise.all([
      this.generateStoryContent(name, lat, lon, lang, aiGuide),
      this.fetchWikiData(name),
    ]);

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

  private async generateStoryContent(name: string, lat: number, lon: number, lang: string, aiGuide: string): Promise<string> {
    const personaInstruction = this.getPersonaInstruction(aiGuide);

    const prompt = `${personaInstruction}

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
