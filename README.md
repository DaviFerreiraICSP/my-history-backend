# Chronos Path - Backend

Servidor NestJS responsável por buscar locais históricos e gerar narrativas imersivas usando IA.

## Tecnologias
- **Framework**: NestJS
- **ORM**: Prisma (PostgreSQL/Neon)
- **IA**: Google Gemini API
- **Geodata**: Overpass API (OpenStreetMap)

## Configuração

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Configure as variáveis de ambiente no arquivo `.env`:
   ```env
   DATABASE_URL="sua_url_do_postgres"
   GEMINI_API_KEY="sua_chave_do_gemini"
   PORT=3000
   ```

3. Sincronize o banco de dados:
   ```bash
   npx prisma db push
   ```

## Rodando a aplicação

```bash
# Desenvolvimento
npm run start:dev

# Produção
npm run build
npm run start:prod
```

## Endpoints Principais

- `GET /history/nearby?lat={lat}&lon={lon}`: Busca pontos históricos num raio de 1km.
- `GET /history/story?name={nome}&lat={lat}&lon={lon}`: Gera ou recupera a história de um local.
