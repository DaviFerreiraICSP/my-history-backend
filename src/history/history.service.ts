import {
  Injectable,
  Logger,
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

  private sanitizeName(raw: string): string {
    return raw
      .replace(/[\r\n\t]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 200);
  }

  async getStory(name: string, lat: number, lon: number, lang: string = 'pt-BR', aiGuide: string = 'historian') {
    const safeName = this.sanitizeName(name);
    this.logger.log(`Getting story for ${safeName} in ${lang} with guide: ${aiGuide}`);

    const wikiData = await this.fetchWikiData(safeName);
    const storyText = await this.generateStoryContent(safeName, lat, lon, lang, aiGuide, wikiData.extract);

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

    const fetchWikiArticle = async (lang: string): Promise<{ wikiUrl: string | null, extract: string | null, photoUrl: string | null }> => {
      const res = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
        params: {
          action: 'query',
          format: 'json',
          formatversion: 2,
          prop: 'info|extracts|pageimages',
          inprop: 'url',
          exintro: true,
          explaintext: true,
          exsentences: 6,
          pithumbsize: 800,
          pilicense: 'any',
          titles: name,
          origin: '*',
        },
        headers,
        timeout: 8000,
      });
      const page = res.data?.query?.pages?.[0];
      if (!page || page.missing) return { wikiUrl: null, extract: null, photoUrl: null };
      return {
        wikiUrl: page.fullurl || null,
        extract: page.extract || null,
        photoUrl: page.thumbnail?.source || null,
      };
    };

    try {
      const [ptData, enData] = await Promise.all([
        fetchWikiArticle('pt').catch(() => ({ wikiUrl: null, extract: null, photoUrl: null })),
        fetchWikiArticle('en').catch(() => ({ wikiUrl: null, extract: null, photoUrl: null })),
      ]);
      return {
        photoUrl: enData.photoUrl || ptData.photoUrl,
        wikiUrl: ptData.wikiUrl || enData.wikiUrl,
        extract: enData.extract || ptData.extract,
      };
    } catch (error) {
      this.logger.warn(`Could not fetch wiki data for ${name}`, error.message);
      return { photoUrl: null, wikiUrl: null, extract: null };
    }
  }
}
