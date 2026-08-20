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
│ ├─ Host: 161.35.52.253           │
│ ├─ Port: 55433                   │
│ ├─ Database: flying_integratia   │
│ ├─ Schema: flying                │
│ └─ Table: alunos                 │
└──────────────────────────────────┘
```

## Infrastructure

### 1. PostgreSQL Database

- **Host**: `161.35.52.253:55433`
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
DATABASE_URL=postgresql://flying_app:<password>@161.35.52.253:55433/flying_integratia
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
psql "postgresql://flying_app:<password>@161.35.52.253:55433/flying_integratia" -f sql/01_create_alunos_mysql.sql
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
