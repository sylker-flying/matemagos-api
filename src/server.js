const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const crypto = require("crypto");
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

function normalizeMultilineEnvValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value).replace(/\\n/g, "\n").trim();
}

function getMysqlSslOptions() {
  const sslEnabled = toBool(process.env.MYSQL_SSL, true);
  if (!sslEnabled) {
    return undefined;
  }

  const rejectUnauthorized = toBool(
    process.env.MYSQL_SSL_REJECT_UNAUTHORIZED,
    true
  );
  const sslOptions = {
    rejectUnauthorized
  };

  const caFromEnv = normalizeMultilineEnvValue(process.env.MYSQL_SSL_CA);
  if (caFromEnv) {
    sslOptions.ca = caFromEnv;
    return sslOptions;
  }

  const caBase64 = normalizeMultilineEnvValue(process.env.MYSQL_SSL_CA_BASE64);
  if (caBase64) {
    sslOptions.ca = Buffer.from(caBase64, "base64").toString("utf8");
  }

  return sslOptions;
}

function createMysqlPoolFromEnv() {
  const sslOptions = getMysqlSslOptions();

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

function normalizeMatricula(payload) {
  const raw = payload?.matricula ?? payload?.playerId;
  if (raw === undefined || raw === null) {
    return null;
  }

  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDeviceId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function hashDeviceId(deviceId) {
  return crypto.createHash("sha256").update(deviceId).digest("hex");
}

function toStoredDeviceId(deviceId) {
  const normalized = String(deviceId).trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(normalized)) {
    return normalized;
  }

  return hashDeviceId(deviceId);
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

app.put("/device-id", async (req, res) => {
  try {
    const matricula = normalizeMatricula(req.body || {});
    const deviceId = normalizeDeviceId(req.body?.deviceId);

    if (!deviceId) {
      return res.status(400).json({ message: "deviceId is required" });
    }

    if (!matricula) {
      return res.status(400).json({
        message: "matricula or playerId is required"
      });
    }

    const alunoExists = await findAlunoByMatricula(matricula, "matricula");
    if (!alunoExists) {
      return res.status(404).json({ message: "aluno not found" });
    }

    await query(
      `
      UPDATE alunos
      SET device = ?
      WHERE matricula = ?
      `,
      [toStoredDeviceId(deviceId), matricula]
    );

    return res.json({ message: "device id updated" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.put("/device-id/reset", async (req, res) => {
  try {
    const matricula = normalizeMatricula(req.body || {});

    if (!matricula) {
      return res.json({
        message: "device id reset skipped (matricula or playerId not provided)"
      });
    }

    await query(
      `
      UPDATE alunos
      SET device = NULL
      WHERE matricula = ?
      `,
      [matricula]
    );

    return res.json({ message: "device id reset" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.put("/alunos/:matricula/stats", async (req, res) => {
  try {
    const { matricula } = req.params;
    const { pontos, progresso } = req.body;

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
        pontos = COALESCE(?, pontos),
        progresso = COALESCE(?, progresso)
      WHERE matricula = ?
      `,
      [parsedPontos, parsedProgresso, matricula]
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

    const parsedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 10 : parsedLimit, 1), 100);
    const result = await query(
      `SELECT a1.matricula,
              a1.nickname,
              a1.pontos,
              0 AS vitorias,
              a1.escola,
              (
                SELECT COUNT(*) + 1
                FROM alunos a2
                WHERE a2.ticket = a1.ticket
                  AND (
                    a2.pontos > a1.pontos
                    OR (a2.pontos = a1.pontos AND a2.matricula < a1.matricula)
                  )
              ) AS rank_pos
       FROM alunos a1
       WHERE a1.ticket = ?
       ORDER BY a1.pontos DESC, a1.matricula ASC
       LIMIT ${limit}`,
      [ticket]
    );
    return res.json(
      result.rows.map((row) => ({
        ...row,
        rank: row.rank_pos
      }))
    );
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
      `SELECT a1.matricula,
              a1.nickname,
              a1.avatar,
              a1.escola,
              0 AS partidas,
              0 AS vitorias,
              a1.pontos,
              (
                SELECT COUNT(*) + 1
                FROM alunos a2
                WHERE a2.ticket = a1.ticket
                  AND (
                    a2.pontos > a1.pontos
                    OR (a2.pontos = a1.pontos AND a2.matricula < a1.matricula)
                  )
              ) AS rank_pos
       FROM alunos a1
       WHERE a1.ticket = ?
         AND a1.matricula = ?
       LIMIT 1`,
      [ticket, matricula]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "aluno not found" });
    }
    return res.json({
      ...result.rows[0],
      rank: result.rows[0].rank_pos
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Matemagos API listening on port ${port}`);
});
