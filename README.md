# Matemagos Backend API

REST API gateway for Matemagos Unity game, connecting to a PostgreSQL database via Railway cloud platform.

## Architecture Overview

```
┌─────────────────────┐
│ Matemagos Unity Game │
│   (Client)          │
└──────────┬──────────┘
           │ HTTP/HTTPS
           ▼
┌──────────────────────────────────────────────┐
│   Railway Cloud Platform                      │
│   ├─ Node.js Express API (src/server.js)     │
│   │   └─ 5 REST Endpoints                    │
│   └─ Environment: DATABASE_URL, DB_SCHEMA, PG_SSL, PG_SSL_REJECT_UNAUTHORIZED, PG_SSL_CA, CORS_ORIGIN │
└──────────┬───────────────────────────────────┘
           │ PostgreSQL Driver (pg)
           ▼
┌──────────────────────────────────┐
│ PostgreSQL Database              │
│ ├─ Host: 157.245.87.116           │
│ ├─ Port: 55433                   │
│ ├─ Database: flying_integratia   │
│ ├─ Schema: flying                │
│ └─ Table: alunos                 │
└──────────────────────────────────┘
```

## Infrastructure

### 1. PostgreSQL Database

- **Host**: `157.245.87.116:55433`
- **Database**: `flying_integratia`
- **Schema**: `flying`
- **Table**: `alunos`
  - Primary key: `id` (bigserial)
  - Unique key: `matricula` (varchar)
  - Data: nome, nickname, avatar, sexo, nascimento, escola, ano, turma
  - Stats: vitorias, derrotas, acertos, erros, progresso
- **SSL**: Optional (`PG_SSL=false` by default)

### 2. Backend API (Railway Cloud)

- **Hosting**: Railway.app
- **Framework**: Express.js v4.19.2 (Node.js)
- **Source Code**: https://github.com/sylker-flying/matemagos-api
- **Repository**: GitHub main branch (auto-deploys on push)
- **Production URL**: https://matemagos-api-production.up.railway.app

#### Environment Variables (Railway Dashboard → Variables):

```
DATABASE_URL=postgresql://flying_app:<password>@157.245.87.116:55433/flying_integratia
DB_SCHEMA=flying
PG_SSL=false
PG_SSL_REJECT_UNAUTHORIZED=false
CORS_ORIGIN=*
```

You can also use `PG_SSL_CA_BASE64` instead of `PG_SSL_CA` if copying a PEM block into Railway is inconvenient.

### 3. Unity Client

- **File**: `Assets/_Matemagos/Scripts/Utils/Database.cs`
- **API URL**: `https://matemagos-api-production.up.railway.app` (configured in public field)
- **HTTP Client**: UnityWebRequest (coroutines)
- **Features**: Player check, creation, avatar/stats updates

## Deployment Pipeline

1. **Local Development**: 
   - Set `.env` with PostgreSQL credentials
   - Run `npm run dev` (uses localhost:8080)
   - Test endpoints locally

2. **Push to GitHub**:
   - Commit changes to `https://github.com/sylker-flying/matemagos-api`
   - Push to `main` branch

3. **Railway Auto-Deploy**:
   - Railway detects new commit
   - Builds using Nixpacks (detects Node.js from package.json)
   - Runs `npm start` → `node src/server.js`
   - API available at `https://matemagos-api-production.up.railway.app`

4. **Unity Connection**:
   - Game reads `ApiURL` from `Database.cs`
   - Calls Railway API endpoints via UnityWebRequest
  - Data persists in PostgreSQL

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Local Environment

```bash
cp .env.example .env
```

Set `DATABASE_URL` to your PostgreSQL connection string and `DB_SCHEMA` to the target schema.

If your PostgreSQL server requires TLS, also set one of:

```bash
PG_SSL_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
```

or:

```bash
PG_SSL_CA_BASE64="<base64-encoded-pem>"
```

### 2.1 Create Schema (PostgreSQL)

Run:

```bash
psql "postgresql://flying_app:<password>@157.245.87.116:55433/flying_integratia" -f sql/01_create_alunos_mysql.sql
```

### 3. Run Locally

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:8080/health
```

## Endpoints

- `POST /alunos`
- `GET /alunos/:matricula`
- `PUT /alunos/:matricula`
- `PUT /alunos/:matricula/stats`
- `PUT /device-id`
- `PUT /device-id/reset`
- `POST /partidas`, `GET /partidas`
- `POST /habilidades`
- `GET /questoes/random`
- `GET /leaderboard/top`, `GET /leaderboard/rank/:matricula`
- `GET /direcionamentos/:matricula`
- `GET /torneios/:id/ranking?matricula=`

### Create aluno

```bash
curl -X POST http://localhost:8080/alunos \
  -H "Content-Type: application/json" \
  -d '{
    "matricula": "20260001",
    "nome": "Aluno Teste",
    "nickname": "teste",
    "sexo": "O",
    "nascimento": "2012-05-10",
    "escola": "Escola Central",
    "ano": 6,
    "turma": "A",
    "vitorias": 3,
    "derrotas": 1,
    "acertos": 25,
    "erros": 5,
    "progresso": 42.5
  }'
```

### Get aluno

```bash
curl http://localhost:8080/alunos/20260001
```

### Update stats

```bash
curl -X PUT http://localhost:8080/alunos/20260001/stats \
  -H "Content-Type: application/json" \
  -d '{
    "vitorias": 4,
    "acertos": 30,
    "progresso": 50
  }'
```

### Record skill performance (`POST /habilidades`)

One row per BNCC code and question source in a match. `jogo` is set by the API (`GAME_CODE`, default `matemagos`, must exist in `flying.jogos`). Send at most one of:

- `questao_id`: the bank question answered (`flying.questoes.id`, as returned by `GET /questoes/random`) → `origem = acervo`;
- `gerador`: the game's generator and version (e.g. `fracoes-v1`, lowercase) → `origem = gerada`.

Older game builds send neither and the row is stored without origin. Requires `sql/11_jogo_e_origem_das_respostas.sql`.

```bash
curl -X POST http://localhost:8080/habilidades \
  -H "Content-Type: application/json" \
  -d '{"matricula":"20260001","habilidade":"EF05MA03","tentativas":3,"acertos":2,"performance":0.6667,"gerador":"fracoes-v1"}'
```

### Directions from Sabido interventions (`GET /direcionamentos/:matricula`)

Teachers and managers create pedagogical interventions in Sabido; the game actions (missions and small class or school tournaments) are published to `flying.direcionamentos`. Requires `migrations/20261127_direcionamentos.sql` (Sabido repository). Before it runs, the route returns `[]` and the fields below are ignored.

```bash
curl "http://localhost:8080/direcionamentos/20260001?modo=individual"
```

```json
[{ "id": 12, "tipo": "missao", "nome": null, "peso": 0.5, "classificacao": null, "modo": null, "jogo": null,
   "inicio": "...", "fim": "...", "equipe": null,
   "habilidades": [{ "matriz": "bncc", "codigo": "EF05MA08" }, { "matriz": "saeb", "codigo": "D3" }],
   "bncc": ["EF05MA08"] }]
```

- `peso`: share of the questions to draw from `bncc` (up to 0.7 in a mission, up to 1 in a tournament). With several directions, join the skills and use the largest weight.
- `tipo = torneio`: a tournament separate from the official ranking. Pair only its participants (Fusion session property), show `nome`; `classificacao` is `evolucao`, `equipes` (use `equipe`) or `pontos`. Sabido computes its ranking.
- `modo`: send `individual` or `pvp` to get only the directions for that mode.

Then send `direcionamento_id` with `POST /partidas` and `POST /habilidades` for every match and answer played under it, and `pontos` (points earned in the match, the same amount added to `alunos.pontos`) with every match. A direction that ended (more than 2 hours ago), was deactivated, belongs to another game or does not include the student is stored as empty instead of rejecting the row.

Tournament ranking, for one of its participants (others show only the short name; `eu` marks the asking student):

```bash
curl "http://localhost:8080/torneios/12/ranking?matricula=20260001"
```

It returns `torneio`, `alunos` (posicao, nome, equipe, partidas, vitorias, pontos, respostas, acerto, acerto_antes, evolucao, eu) and `equipes` (ranked by mean evolution, or by points when the tournament ranks by points). Computed by `flying.ranking_torneio` (Sabido `migrations/20261128_ranking_torneio.sql`), the same function Sabido uses.

Bank questions can be filtered by BNCC code: `GET /questoes/random?bncc=EF05MA08,EF05MA03`.

### Tests

```bash
TEST_DATABASE_URL=postgresql://... npm test
```

Use a disposable copy of the Flying database with the directions migration applied: the tests write and remove rows.
