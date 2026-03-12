# Matemagos Backend API

REST API gateway for Matemagos Unity game, connecting to Aiven MySQL database via Railway cloud platform.

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
│   └─ Environment: DATABASE_URL, MYSQL_SSL, MYSQL_SSL_REJECT_UNAUTHORIZED, CORS_ORIGIN  │
└──────────┬───────────────────────────────────┘
           │ MySQL Driver (mysql2)
           ▼
┌──────────────────────────────────┐
│ Aiven Cloud MySQL                │
│ ├─ Host: <aiven-mysql-host>      │
│ ├─ Port: <aiven-mysql-port> (SSL)│
│ ├─ Database: matemagos           │
│ └─ Table: alunos                 │
└──────────────────────────────────┘
```

## Infrastructure

### 1. MySQL Database (Aiven Cloud)

- **Provider**: Aiven.io
- **Host**: `<your-aiven-mysql-host>:<your-aiven-mysql-port>`
- **Database**: `matemagos`
- **Table**: `alunos`
  - Primary key: `id` (auto increment)
  - Unique key: `matricula` (varchar)
  - Data: nome, nickname, avatar, sexo, nascimento, escola, ano, turma
  - Stats: vitorias, derrotas, acertos, erros, progresso
- **SSL**: Enabled (`MYSQL_SSL=true`)

### 2. Backend API (Railway Cloud)

- **Hosting**: Railway.app
- **Framework**: Express.js v4.19.2 (Node.js)
- **Source Code**: https://github.com/sylker-flying/matemagos-api
- **Repository**: GitHub main branch (auto-deploys on push)
- **Production URL**: https://matemagos-api-production.up.railway.app

#### Environment Variables (Railway Dashboard → Variables):

```
DATABASE_URL=mysql://<user>:<password>@<host>:<port>/<database>
MYSQL_SSL=true
MYSQL_SSL_REJECT_UNAUTHORIZED=true
CORS_ORIGIN=*
```

### 3. Unity Client

- **File**: `Assets/_Matemagos/Scripts/Utils/Database.cs`
- **API URL**: `https://matemagos-api-production.up.railway.app` (configured in public field)
- **HTTP Client**: UnityWebRequest (coroutines)
- **Features**: Player check, creation, avatar/stats updates

## Deployment Pipeline

1. **Local Development**: 
   - Set `.env` with Aiven credentials
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
   - Game reads `PostgresApiUrl` from Database.cs
   - Calls Railway API endpoints via UnityWebRequest
  - Data persists in Aiven MySQL

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Local Environment

```bash
cp .env.example .env
```

Set `DATABASE_URL` to your MySQL connection string.

### 2.1 Create Schema (Aiven MySQL)

Run:

```bash
mysql --host=<host> --port=<port> --user=<user> --password <database> < sql/01_create_alunos_mysql.sql
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
