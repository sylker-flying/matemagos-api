const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);

function toBool(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return defaultValue;
}

function createMysqlPoolFromEnv() {
  const sslEnabled = toBool(process.env.MYSQL_SSL, true);
  const rejectUnauthorized = toBool(
    process.env.MYSQL_SSL_REJECT_UNAUTHORIZED,
    true
  );
  const sslOptions = sslEnabled
    ? {
        rejectUnauthorized
      }
    : undefined;

  const rawConnectionUrls = [process.env.MYSQL_URL, process.env.DATABASE_URL].filter(
    Boolean
  );

  for (const rawUrl of rawConnectionUrls) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (_error) {
      continue;
    }

    if (!["mysql:", "mysql2:"].includes(parsed.protocol)) {
      continue;
    }

    return mysql.createPool({
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      ssl: sslOptions,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
      queueLimit: 0
    });
  }

  if (process.env.DATABASE_URL && !process.env.MYSQL_URL) {
    console.warn(
      "Ignoring non-MySQL DATABASE_URL. Set MYSQL_URL or MYSQLHOST/MYSQLPORT/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE."
    );
  }

  return mysql.createPool({
    host: process.env.MYSQLHOST || process.env.DB_HOST,
    port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQLUSER || process.env.DB_USER,
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
    database: process.env.MYSQLDATABASE || process.env.DB_NAME,
    ssl: sslOptions,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    queueLimit: 0
  });
}

const pool = createMysqlPoolFromEnv();

async function query(sql, params = []) {
  const [result] = await pool.execute(sql, params);

  if (Array.isArray(result)) {
    return {
      rows: result,
      rowCount: result.length,
      affectedRows: result.length
    };
  }

  return {
    rows: [],
    rowCount: Number(result.affectedRows || 0),
    affectedRows: Number(result.affectedRows || 0)
  };
}

async function findAlunoByMatricula(matricula, selectClause = "*") {
  const result = await query(
    `SELECT ${selectClause} FROM alunos WHERE matricula = ? LIMIT 1`,
    [matricula]
  );

  return result.rows[0] || null;
}

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "1mb" }));

const ALUNOS_SELECTABLE_FIELDS = new Set([
  "id",
  "matricula",
  "nome",
  "nickname",
  "avatar",
  "sexo",
  "nascimento",
  "escola",
  "ano",
  "turma",
  "partidas_pve",
  "partidas_pvp",
  "vitorias_pve",
  "vitorias_pvp",
  "questoes",
  "acertos",
  "pontos",
  "progresso",
  "device",
  "ticket",
  "validade",
  "criado_em",
  "atualizado_em"
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
    const result = await query("SELECT NOW() AS now");
    res.json({ status: "ok", dbTime: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/alunos/:matricula", async (req, res) => {
  try {
    const { matricula } = req.params;
    const selectClause = buildAlunoSelectClause(req.query.select);
    const aluno = await findAlunoByMatricula(matricula, selectClause);

    if (!aluno) {
      return res.status(404).json({ message: "aluno not found" });
    }

    return res.json(aluno);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.put("/alunos/:matricula/stats", async (req, res) => {
  try {
    const { matricula } = req.params;
    const {
      partidas_pve,
      partidas_pvp,
      vitorias_pve,
      vitorias_pvp,
      questoes,
      acertos,
      pontos,
      progresso,
      // Legacy compatibility fields used by older Unity clients.
      partidas,
      vitorias,
      derrotas,
      erros
    } = req.body;

    const parsedPartidasPve = parseNonNegativeInt(partidas_pve, "partidas_pve");
    let parsedPartidasPvp = parseNonNegativeInt(
      partidas_pvp ?? partidas,
      "partidas_pvp"
    );
    const parsedVitoriasPve = parseNonNegativeInt(vitorias_pve, "vitorias_pve");
    const parsedVitoriasPvp = parseNonNegativeInt(
      vitorias_pvp ?? vitorias,
      "vitorias_pvp"
    );

    if (parsedPartidasPvp === null) {
      const parsedDerrotas = parseNonNegativeInt(derrotas, "derrotas");
      if (parsedVitoriasPvp !== null && parsedDerrotas !== null) {
        parsedPartidasPvp = parsedVitoriasPvp + parsedDerrotas;
      }
    }

    let parsedQuestoes = parseNonNegativeInt(questoes, "questoes");
    if (parsedQuestoes === null) {
      const parsedErros = parseNonNegativeInt(erros, "erros");
      const parsedAcertosCandidate = parseNonNegativeInt(acertos, "acertos");
      if (parsedErros !== null && parsedAcertosCandidate !== null) {
        parsedQuestoes = parsedAcertosCandidate + parsedErros;
      }
    }

    const parsedAcertos = parseNonNegativeInt(acertos, "acertos");
    const parsedPontos = parseNonNegativeInt(pontos, "pontos");
    const parsedProgresso = parseProgress(progresso);

    const alunoExists = await findAlunoByMatricula(matricula, "matricula");
    if (!alunoExists) {
      return res.status(404).json({ message: "aluno not found" });
    }

    await query(
      `
      UPDATE alunos
      SET
        partidas_pve = COALESCE(?, partidas_pve),
        partidas_pvp = COALESCE(?, partidas_pvp),
        vitorias_pve = COALESCE(?, vitorias_pve),
        vitorias_pvp = COALESCE(?, vitorias_pvp),
        questoes = COALESCE(?, questoes),
        acertos = COALESCE(?, acertos),
        pontos = COALESCE(?, pontos),
        progresso = COALESCE(?, progresso)
      WHERE matricula = ?
      `,
      [
        parsedPartidasPve,
        parsedPartidasPvp,
        parsedVitoriasPve,
        parsedVitoriasPvp,
        parsedQuestoes,
        parsedAcertos,
        parsedPontos,
        parsedProgresso,
        matricula
      ]
    );

    const updatedAluno = await findAlunoByMatricula(matricula);

    return res.json(updatedAluno);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.put("/alunos/:matricula", async (req, res) => {
  try {
    const { matricula } = req.params;
    const {
      nickname,
      avatar,
      escola,
      ano,
      turma,
      device,
      ticket,
      validade
    } = req.body;

    const normalizedNickname = normalizeNickname(nickname);

    if (normalizedNickname) {
      const nicknameExists = await query(
        `SELECT 1
         FROM alunos
         WHERE LOWER(TRIM(nickname)) = LOWER(TRIM(?))
           AND matricula <> ?
         LIMIT 1`,
        [normalizedNickname, matricula]
      );

      if (nicknameExists.rowCount > 0) {
        return res.status(409).json({
          message: "Este nickname já está em uso. Tente um apelido diferente."
        });
      }
    }

    const alunoExists = await findAlunoByMatricula(matricula, "matricula");
    if (!alunoExists) {
      return res.status(404).json({ message: "aluno not found" });
    }

    await query(
      `
      UPDATE alunos
      SET
        nickname = COALESCE(?, nickname),
        avatar = COALESCE(?, avatar),
        escola = COALESCE(?, escola),
        ano = COALESCE(?, ano),
        turma = COALESCE(?, turma),
        device = COALESCE(?, device),
        ticket = COALESCE(?, ticket),
        validade = COALESCE(?, validade)
      WHERE matricula = ?
      `,
      [
        normalizedNickname,
        avatar ?? null,
        escola ?? null,
        ano ?? null,
        turma ?? null,
        device ?? null,
        ticket ?? null,
        validade ?? null,
        matricula
      ]
    );

    const updatedAluno = await findAlunoByMatricula(matricula);

    return res.json(updatedAluno);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY" || error.errno === 1062) {
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
    const result = await query(
          `SELECT matricula, nickname, pontos,
            vitorias_pvp,
            vitorias_pvp AS vitorias,
            escola,
              ROW_NUMBER() OVER (ORDER BY pontos DESC, matricula ASC) AS rank
       FROM alunos
       WHERE ticket = ?
       ORDER BY pontos DESC
       LIMIT ?`,
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

    const result = await query(
      `SELECT matricula, nickname, avatar, escola,
              partidas_pvp,
              vitorias_pvp,
              partidas_pvp AS partidas,
              vitorias_pvp AS vitorias,
              pontos,
              rank
       FROM (
         SELECT matricula, nickname, avatar, escola, partidas_pvp, vitorias_pvp, pontos,
                ROW_NUMBER() OVER (ORDER BY pontos DESC, matricula ASC) AS rank
         FROM alunos
         WHERE ticket = ?
       ) ranked
       WHERE matricula = ?`,
      [ticket, matricula]
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
