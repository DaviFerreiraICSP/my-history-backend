# Our History — Backend

API NestJS do explorador histórico imersivo **Our History**.

## Tecnologias

| Biblioteca | Função |
|---|---|
| NestJS + TypeScript | Framework de API |
| Prisma + PostgreSQL | ORM e banco de dados (Neon) |
| Google Gemini API | Geração de narrativas por IA |
| Wikipedia Geosearch API | Busca de locais históricos próximos |
| @nestjs/throttler | Rate limiting |
| Helmet | Headers de segurança HTTP |

## Configuração

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Crie um arquivo `.env` na raiz:
   ```env
   DATABASE_URL="postgresql://..."
   GEMINI_API_KEY="sua_chave_gemini"
   PORT=3000
   ```

3. Sincronize o banco de dados:
   ```bash
   npx prisma db push
   ```

4. Inicie em desenvolvimento:
   ```bash
   npm run start:dev
   ```

## Scripts

```bash
npm run start:dev    # Desenvolvimento com hot-reload
npm run build        # Build de produção (gera Prisma Client + compila)
npm run start:prod   # Inicia a versão compilada
npm run lint         # Lint com auto-fix
```

## Endpoints

### `GET /history/story`

Gera ou recupera a narrativa imersiva de um local histórico.

**Query params:**

| Param | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `name` | string | sim | Nome do local |
| `lat` | number | não | Latitude (contexto geográfico para a IA) |
| `lon` | number | não | Longitude |
| `lang` | string | não | Idioma da narrativa (default: `pt-BR`) |
| `aiGuide` | string | não | Persona da IA: `historian`, `explorer`, `poet`, `philosopher` (default: `historian`) |

**Exemplo:**
```
GET /history/story?name=Catedral+da+Sé&lat=-23.55&lon=-46.63&lang=pt-BR&aiGuide=historian
```

## Rate Limiting

| Nível | Endpoint | Limite |
|---|---|---|
| Global (burst) | todos | 5 req / 10 s |
| Global (sustentado) | todos | 30 req / 1 min |
| Story (burst) | `/history/story` | 3 req / 10 s |
| Story (sustentado) | `/history/story` | 10 req / 1 min |

## Segurança

- **CORS** restrito a `historyfrontend.vercel.app` e variantes Vercel + `localhost` em dev
- **Helmet** com headers padrão de segurança
- **Validação** com `ValidationPipe` (whitelist, transform, forbidNonWhitelisted)

## Deploy (Vercel)

Defina as variáveis `DATABASE_URL` e `GEMINI_API_KEY` no painel da Vercel.  
O script `postinstall` executa `prisma generate` automaticamente no deploy.
