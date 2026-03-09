# Matemagos Backend API

Simple Express API for `public.alunos` in PostgreSQL.

## 1. Install

```bash
cd backend-api
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Set `DATABASE_URL` to your PostgreSQL connection string.

## 3. Run

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
