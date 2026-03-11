const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "1mb" }));

function parseNonNegativeInt(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return parsed;
}

function parseProgress(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("progresso must be between 0 and 100");
  }

  return parsed;
}

app.get("/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({ status: "ok", dbTime: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.post("/alunos", async (req, res) => {
  try {
    const {
      matricula,
      nome,
      nickname,
      avatar,
      sexo,
      nascimento,
      escola,
      ano,
      turma,
      vitorias,
      derrotas,
      acertos,
      erros,
      progresso
    } = req.body;

    if (!matricula || !nome) {
      return res.status(400).json({ message: "matricula and nome are required" });
    }

    const parsedVitorias = parseNonNegativeInt(vitorias, "vitorias") ?? 0;
    const parsedDerrotas = parseNonNegativeInt(derrotas, "derrotas") ?? 0;
    const parsedAcertos = parseNonNegativeInt(acertos, "acertos") ?? 0;
    const parsedErros = parseNonNegativeInt(erros, "erros") ?? 0;
    const parsedProgresso = parseProgress(progresso) ?? 0;

    const query = `
      INSERT INTO public.alunos (
        matricula, nome, nickname, avatar, sexo, nascimento, escola, ano, turma,
        vitorias, derrotas, acertos, erros, progresso
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14
      )
      RETURNING *
    `;

    const values = [
      matricula,
      nome,
      nickname ?? null,
      avatar ?? null,
      sexo ?? null,
      nascimento ?? null,
      escola ?? null,
      ano ?? null,
      turma ?? null,
      parsedVitorias,
      parsedDerrotas,
      parsedAcertos,
      parsedErros,
      parsedProgresso
    ];

    const result = await pool.query(query, values);
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "matricula already exists" });
    }

    return res.status(400).json({ message: error.message });
  }
});

app.get("/alunos/:matricula", async (req, res) => {
  try {
    const { matricula } = req.params;
    const result = await pool.query(
      "SELECT * FROM public.alunos WHERE matricula = $1",
      [matricula]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "aluno not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.put("/alunos/:matricula/stats", async (req, res) => {
  try {
    const { matricula } = req.params;
    const { vitorias, derrotas, acertos, erros, progresso } = req.body;

    const parsedVitorias = parseNonNegativeInt(vitorias, "vitorias");
    const parsedDerrotas = parseNonNegativeInt(derrotas, "derrotas");
    const parsedAcertos = parseNonNegativeInt(acertos, "acertos");
    const parsedErros = parseNonNegativeInt(erros, "erros");
    const parsedProgresso = parseProgress(progresso);

    const result = await pool.query(
      `
      UPDATE public.alunos
      SET
        vitorias = COALESCE($2, vitorias),
        derrotas = COALESCE($3, derrotas),
        acertos = COALESCE($4, acertos),
        erros = COALESCE($5, erros),
        progresso = COALESCE($6, progresso)
      WHERE matricula = $1
      RETURNING *
      `,
      [
        matricula,
        parsedVitorias,
        parsedDerrotas,
        parsedAcertos,
        parsedErros,
        parsedProgresso
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "aluno not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.put("/alunos/:matricula", async (req, res) => {
  try {
    const { matricula } = req.params;
    const {
      nome,
      nickname,
      avatar,
      sexo,
      nascimento,
      escola,
      ano,
      turma
    } = req.body;

    const result = await pool.query(
      `
      UPDATE public.alunos
      SET
        nome = COALESCE($2, nome),
        nickname = COALESCE($3, nickname),
        avatar = COALESCE($4, avatar),
        sexo = COALESCE($5, sexo),
        nascimento = COALESCE($6, nascimento),
        escola = COALESCE($7, escola),
        ano = COALESCE($8, ano),
        turma = COALESCE($9, turma)
      WHERE matricula = $1
      RETURNING *
      `,
      [
        matricula,
        nome ?? null,
        nickname ?? null,
        avatar ?? null,
        sexo ?? null,
        nascimento ?? null,
        escola ?? null,
        ano ?? null,
        turma ?? null
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "aluno not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

// GET /leaderboard/top?limit=N  — top N players by pontos desc
app.get("/leaderboard/top", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const result = await pool.query(
      `SELECT matricula, nickname, pontos, vitorias, escola,
              RANK() OVER (ORDER BY pontos DESC) AS rank
       FROM public.alunos
       ORDER BY pontos DESC
       LIMIT $1`,
      [limit]
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// GET /leaderboard/rank/:matricula  — rank and score for a single player
app.get("/leaderboard/rank/:matricula", async (req, res) => {
  try {
    const { matricula } = req.params;
    const result = await pool.query(
      `SELECT matricula, nickname, pontos, vitorias, escola,
              RANK() OVER (ORDER BY pontos DESC) AS rank
       FROM public.alunos
       WHERE matricula = $1`,
      [matricula]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "aluno not found" });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Matemagos API listening on port ${port}`);
});
