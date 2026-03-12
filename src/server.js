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

const ALUNOS_SELECTABLE_FIELDS = new Set([
  "matricula",
  "nickname",
  "avatar",
  "escola",
  "ano",
  "turma",
  "partidas",
  "vitorias",
  "questoes",
  "acertos",
  "pontos",
  "progresso",
  "device",
  "ticket",
  "validade"
]);

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

function buildAlunoSelectClause(selectParam) {
  if (!selectParam) {
    return "*";
  }

  const requestedFields = String(selectParam)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);

  if (requestedFields.length === 0) {
    return "*";
  }

  const uniqueFields = [...new Set(requestedFields)];
  const invalidFields = uniqueFields.filter(
    (field) => !ALUNOS_SELECTABLE_FIELDS.has(field)
  );

  if (invalidFields.length > 0) {
    const error = new Error(
      `invalid select fields: ${invalidFields.join(", ")}`
    );
    error.statusCode = 400;
    throw error;
  }

  return uniqueFields.join(", ");
}

function normalizeNickname(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

app.get("/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({ status: "ok", dbTime: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

/*
app.post("/alunos", async (req, res) => {
  try {
    const {
      matricula,
      nickname,
      avatar,
      escola,
      ano,
      turma,
      partidas,
      vitorias,
      derrotas,
      questoes,
      acertos,
      progresso,
      pontos,
      device,
      ticket,
      validade,
    } = req.body;

    if (!matricula) {
      return res.status(400).json({ message: "matricula is required" });
    }

    const query = `
      INSERT INTO public.alunos (
        matricula, nickname, avatar, escola, ano, turma, partidas, vitorias, derrotas, questoes, acertos, progresso, pontos, device, ticket, validade
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )
      RETURNING *
    `;

    const values = [
      matricula,
      nickname ?? null,
      avatar ?? null,
      escola ?? null,
      ano ?? null,
      turma ?? null,
      partidas ?? null,
      vitorias ?? null,
      derrotas ?? null,
      questoes ?? null,
      acertos ?? null,
      progresso ?? null,
      pontos ?? null,
      device ?? null,
      ticket ?? null,
      validade ?? null
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
*/

app.get("/alunos/:matricula", async (req, res) => {
  try {
    const { matricula } = req.params;
    const selectClause = buildAlunoSelectClause(req.query.select);
    const result = await pool.query(
      `SELECT ${selectClause} FROM public.alunos WHERE matricula = $1`,
      [matricula]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "aluno not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.put("/alunos/:matricula/stats", async (req, res) => {
  try {
    const { matricula } = req.params;
    const { partidas, vitorias, questoes, acertos, pontos, progresso } = req.body;

    const parsedPartidas = parseNonNegativeInt(partidas, "partidas");
    const parsedVitorias = parseNonNegativeInt(vitorias, "vitorias");
    const parsedQuestoes = parseNonNegativeInt(questoes, "questoes");
    const parsedAcertos = parseNonNegativeInt(acertos, "acertos"); 
    const parsedPontos = parseNonNegativeInt(pontos, "pontos");
    const parsedProgresso = parseProgress(progresso);

    const result = await pool.query(
      `
      UPDATE public.alunos
      SET
        partidas = COALESCE($2, partidas),
        vitorias = COALESCE($3, vitorias),
        questoes = COALESCE($4, questoes),
        acertos = COALESCE($5, acertos),
        pontos = COALESCE($6, pontos),
        progresso = COALESCE($7, progresso)
      WHERE matricula = $1
      RETURNING *
      `,
      [
        matricula,
        parsedPartidas,
        parsedVitorias,
        parsedQuestoes,
        parsedAcertos,
        parsedPontos,
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

    const normalizedNickname = normalizeNickname(nickname);

    if (normalizedNickname) {
      const nicknameExists = await pool.query(
        `SELECT 1
         FROM public.alunos
         WHERE LOWER(BTRIM(nickname)) = LOWER(BTRIM($1))
           AND matricula <> $2
         LIMIT 1`,
        [normalizedNickname, matricula]
      );

      if (nicknameExists.rowCount > 0) {
        return res.status(409).json({
          message: "Este nickname já está em uso. Tente um apelido diferente."
        });
      }
    }

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
        normalizedNickname,
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
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Este nickname já está em uso. Tente um apelido diferente."
      });
    }

    return res.status(400).json({ message: error.message });
  }
});

// GET /leaderboard/top?limit=N  — top N players by pontos desc
app.get("/leaderboard/top", async (req, res) => {
  try {
    const ticket = typeof req.query.ticket === "string" ? req.query.ticket.trim() : "";
    if (!ticket) {
      return res.status(400).json({ message: "ticket is required" });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const result = await pool.query(
      `SELECT matricula, nickname, pontos, vitorias, escola,
              RANK() OVER (ORDER BY pontos DESC) AS rank
       FROM public.alunos
       WHERE ticket = $1
       ORDER BY pontos DESC
       LIMIT $2`,
      [ticket, limit]
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
    const ticket = typeof req.query.ticket === "string" ? req.query.ticket.trim() : "";
    if (!ticket) {
      return res.status(400).json({ message: "ticket is required" });
    }

    const result = await pool.query(
      `SELECT matricula, nickname, avatar, escola, partidas, vitorias, pontos, rank
       FROM (
         SELECT matricula, nickname, avatar, escola, partidas, vitorias, pontos,
                RANK() OVER (ORDER BY pontos DESC) AS rank
         FROM public.alunos
         WHERE ticket = $2
       ) ranked
       WHERE matricula = $1`,
      [matricula, ticket]
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
