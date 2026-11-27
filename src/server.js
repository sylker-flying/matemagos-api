const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const crypto = require("crypto");
const { Pool } = require("pg");

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

function getPostgresSslOptions() {
  const sslEnabled = toBool(
    process.env.PG_SSL ?? process.env.DB_SSL,
    false
  );
  if (!sslEnabled) {
    return undefined;
  }

  const rejectUnauthorized = toBool(
    process.env.PG_SSL_REJECT_UNAUTHORIZED ??
      process.env.DB_SSL_REJECT_UNAUTHORIZED,
    false
  );
  const sslOptions = {
    rejectUnauthorized
  };

  const caFromEnv = normalizeMultilineEnvValue(
    process.env.PG_SSL_CA ?? process.env.DB_SSL_CA
  );
  if (caFromEnv) {
    sslOptions.ca = caFromEnv;
    return sslOptions;
  }

  const caBase64 = normalizeMultilineEnvValue(
    process.env.PG_SSL_CA_BASE64 ?? process.env.DB_SSL_CA_BASE64
  );
  if (caBase64) {
    sslOptions.ca = Buffer.from(caBase64, "base64").toString("utf8");
  }

  return sslOptions;
}

function getDatabaseSchema() {
  const schema =
    process.env.DB_SCHEMA ||
    process.env.PG_SCHEMA ||
    process.env.PGSCHEMA ||
    "public";

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(
      "Invalid DB schema name. Use only letters, numbers, and underscores."
    );
  }

  return schema;
}

function createPostgresPoolFromEnv() {
  const sslOptions = getPostgresSslOptions();
  const schema = getDatabaseSchema();
  const options = `-c search_path=${schema},public`;
  const max = Number(process.env.DB_POOL_SIZE || 10);

  const rawConnectionUrls = [process.env.POSTGRES_URL, process.env.DATABASE_URL].filter(
    Boolean
  );

  for (const rawUrl of rawConnectionUrls) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (_error) {
      continue;
    }

    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      continue;
    }

    return new Pool({
      connectionString: rawUrl,
      ssl: sslOptions,
      max,
      options
    });
  }

  if (process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.warn(
      "Ignoring non-PostgreSQL DATABASE_URL. Set POSTGRES_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE."
    );
  }

  return new Pool({
    host: process.env.PGHOST || process.env.DB_HOST,
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    user: process.env.PGUSER || process.env.DB_USER,
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
    database: process.env.PGDATABASE || process.env.DB_NAME,
    ssl: sslOptions,
    max,
    options
  });
}

const pool = createPostgresPoolFromEnv();

function toPgPlaceholders(sql) {
  let placeholderIndex = 0;
  return sql.replace(/\?/g, () => {
    placeholderIndex += 1;
    return `$${placeholderIndex}`;
  });
}

async function query(sql, params = []) {
  const result = await pool.query(toPgPlaceholders(sql), params);
  return {
    rows: result.rows,
    rowCount: Number(result.rowCount || 0),
    affectedRows: Number(result.rowCount || 0),
    insertId: result.rows[0]?.id ?? null
  };
}

async function findAlunoByMatricula(matricula, selectClause = "*") {
  const result = await query(
    `SELECT ${selectClause} FROM alunos WHERE matricula = ? LIMIT 1`,
    [matricula]
  );

  return result.rows[0] || null;
}

// validade comes from the tickets table (matched by alunos.ticket = tickets.nome).
// acesso: "valido" | "expirado" | "inexistente" (no ticket, or ticket not in tickets).
async function findAlunoComTicket(matricula) {
  const result = await query(
    `SELECT a.*,
            t.validade AS ticket_validade,
            CASE
              WHEN t.nome IS NULL THEN 'inexistente'
              WHEN t.validade IS NOT NULL AND t.validade::date < CURRENT_DATE THEN 'expirado'
              ELSE 'valido'
            END AS acesso
       FROM alunos a
       LEFT JOIN tickets t ON t.nome = TRIM(a.ticket)
      WHERE a.matricula = ?
      LIMIT 1`,
    [matricula]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const { ticket_validade, ...aluno } = row;
  return { ...aluno, validade: ticket_validade };
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
  "acesso",
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
    const aluno = await findAlunoComTicket(matricula);

    if (!aluno) {
      return res.status(404).json({ message: "aluno not found" });
    }

    if (selectClause === "*") {
      return res.json(aluno);
    }

    return res.json(
      Object.fromEntries(
        selectClause.split(", ").map((field) => [field, aluno[field]])
      )
    );
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

    const updatedAluno = await findAlunoComTicket(matricula);

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
      ticket
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
        ticket = COALESCE(?, ticket)
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
        matricula
      ]
    );

    const updatedAluno = await findAlunoComTicket(matricula);

    return res.json(updatedAluno);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Este nickname já está em uso. Tente um apelido diferente."
      });
    }

    return res.status(400).json({ message: error.message });
  }
});

// Display name for leaderboards: first name + last-name initial ("Ana Maria Silva" -> "Ana S.").
// Full names never leave the server since leaderboards are visible to other students.
const NOME_NORMALIZED_SQL = `REGEXP_REPLACE(TRIM(COALESCE(a1.nome, '')), '\\s+', ' ', 'g')`;
const SHORT_NOME_SQL = `CASE
                WHEN POSITION(' ' IN ${NOME_NORMALIZED_SQL}) > 0
                  THEN SPLIT_PART(${NOME_NORMALIZED_SQL}, ' ', 1) || ' ' ||
                       UPPER(LEFT(REGEXP_REPLACE(${NOME_NORMALIZED_SQL}, '^.* ', ''), 1)) || '.'
                ELSE ${NOME_NORMALIZED_SQL}
              END`;

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
              ${SHORT_NOME_SQL} AS nome,
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
              ${SHORT_NOME_SQL} AS nome,
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

const MAX_SECONDS = 999999.99;

// Code of this game in flying.jogos. Every row written by this API belongs to it.
const GAME_CODE = process.env.GAME_CODE || "matemagos";
const GENERATOR_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,39}$/;

// Where the answered question came from: the bank (questao_id) or the game's own generator (gerador).
// Older game builds send neither, and the row is stored with origem empty, as before.
function parseQuestionOrigin(body) {
  const rawId = body.questao_id;
  const rawGenerator = typeof body.gerador === "string" ? body.gerador.trim().toLowerCase() : "";
  const hasId = rawId !== undefined && rawId !== null && String(rawId).trim() !== "";

  if (hasId && rawGenerator) {
    throw new HttpError(400, "send either questao_id or gerador, not both");
  }

  if (hasId) {
    const questaoId = Number(rawId);
    if (!Number.isSafeInteger(questaoId) || questaoId <= 0) {
      throw new HttpError(400, "questao_id must be a positive integer");
    }
    return { origem: "acervo", questaoId, gerador: null };
  }

  if (rawGenerator) {
    if (!GENERATOR_PATTERN.test(rawGenerator)) {
      throw new HttpError(400, "gerador must be lowercase letters, digits, '.', '_' or '-' (up to 40)");
    }
    return { origem: "gerada", questaoId: null, gerador: rawGenerator };
  }

  return { origem: null, questaoId: null, gerador: null };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Directions published by Sabido's pedagogical interventions (flying.direcionamentos, migration
// 20261127_direcionamentos.sql). Until that migration runs, the API behaves exactly as before.
const DIRECTION_SCHEMA_TTL_MS = 60 * 1000;
// A match may be uploaded a little after its direction ends (slow network, end of a long battle).
const DIRECTION_GRACE = "2 hours";
let directionSchema = { checkedAt: 0, ready: false };

async function hasDirectionSchema() {
  if (Date.now() - directionSchema.checkedAt < DIRECTION_SCHEMA_TTL_MS) {
    return directionSchema.ready;
  }
  const result = await query(
    `SELECT to_regclass('direcionamentos') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'partidas' AND column_name = 'pontos') AS ready`
  );
  directionSchema = { checkedAt: Date.now(), ready: Boolean(result.rows[0]?.ready) };
  return directionSchema.ready;
}

function parseDirectionId(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, "direcionamento_id must be a positive integer");
  }
  return id;
}

// The direction a match or answer was played under, if it really applies to this student and game.
// An outdated or unknown direction is not an error: the row is stored without it.
async function resolveDirection(rawId, matricula) {
  const id = parseDirectionId(rawId);
  if (id === null || !(await hasDirectionSchema())) {
    return null;
  }
  const result = await query(
    `SELECT d.id
       FROM direcionamentos d
       JOIN direcionamento_alunos a ON a.direcionamento = d.id AND a.matricula = ?
      WHERE d.id = ?
        AND d.ativo
        AND (d.jogo IS NULL OR d.jogo = ?)
        AND d.inicio <= now()
        AND now() < d.fim + interval '${DIRECTION_GRACE}'
      LIMIT 1`,
    [matricula, id, GAME_CODE]
  );
  return result.rowCount > 0 ? id : null;
}

// GET /direcionamentos/:matricula?modo=individual|pvp — active directions of a student in this game.
// The game asks once when a battle starts and draws `peso` of the questions from `bncc`
// (all skills, any matrix, are in `habilidades`). A tournament also brings its name, ranking and team.
app.get("/direcionamentos/:matricula", async (req, res) => {
  try {
    const matricula = String(req.params.matricula || "").trim();
    const modo = typeof req.query.modo === "string" ? req.query.modo.trim().toLowerCase() : "";
    if (modo && !["individual", "pvp"].includes(modo)) {
      return res.status(400).json({ message: "modo must be individual or pvp" });
    }
    if (!(await hasDirectionSchema())) {
      return res.json([]);
    }

    const result = await query(
      `SELECT d.id, d.tipo, d.nome, d.peso::float8 AS peso, d.classificacao, d.modo, d.jogo, d.inicio, d.fim, a.equipe,
              COALESCE(json_agg(json_build_object('matriz', h.matriz, 'codigo', h.codigo) ORDER BY h.matriz, h.codigo)
                       FILTER (WHERE h.codigo IS NOT NULL), '[]') AS habilidades
         FROM direcionamento_alunos a
         JOIN direcionamentos d ON d.id = a.direcionamento
         LEFT JOIN direcionamento_habilidades h ON h.direcionamento = d.id
        WHERE a.matricula = ?
          AND d.ativo
          AND now() >= d.inicio AND now() < d.fim
          AND (d.jogo IS NULL OR d.jogo = ?)
          AND (? = '' OR d.modo IS NULL OR d.modo = ?)
        GROUP BY d.id, a.equipe
        ORDER BY d.tipo DESC, d.fim`,
      [matricula, GAME_CODE, modo, modo]
    );

    return res.json(
      result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        bncc: row.habilidades.filter((h) => h.matriz === "bncc").map((h) => h.codigo)
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// GET /torneios/:id/ranking?matricula=… — ranking of an intervention tournament, for one of its participants.
// Computed by flying.ranking_torneio (migration 20261128_ranking_torneio.sql), the same function Sabido uses.
// Other students show only the short name; "eu" marks the asking student. Teams are ranked by mean evolution.
app.get("/torneios/:id/ranking", async (req, res) => {
  try {
    const id = parseDirectionId(req.params.id);
    const matricula = typeof req.query.matricula === "string" ? req.query.matricula.trim() : "";
    if (id === null || !matricula) {
      return res.status(400).json({ message: "id and matricula are required" });
    }
    if (!(await hasDirectionSchema())) {
      return res.status(404).json({ message: "tournament not found" });
    }

    const tournament = await query(
      `SELECT d.id, d.nome, d.classificacao, d.inicio, d.fim, d.ativo
         FROM direcionamentos d
         JOIN direcionamento_alunos a ON a.direcionamento = d.id AND a.matricula = ?
        WHERE d.id = ? AND d.tipo = 'torneio' AND (d.jogo IS NULL OR d.jogo = ?)`,
      [matricula, id, GAME_CODE]
    );
    if (tournament.rowCount === 0) {
      return res.status(404).json({ message: "tournament not found" });
    }

    const ranking = await query(
      `SELECT r.matricula, ${SHORT_NOME_SQL.replaceAll("a1.", "r.")} AS nome, r.equipe, r.partidas, r.vitorias, r.pontos,
              r.respostas, r.acerto::float8 AS acerto, r.acerto_antes::float8 AS acerto_antes, r.evolucao::float8 AS evolucao, r.posicao
         FROM ranking_torneio(?) r`,
      [id]
    );

    const alunos = ranking.rows.map(({ matricula: m, ...row }) => ({ ...row, eu: m === matricula }));
    const teams = new Map();
    for (const row of alunos) {
      if (!row.equipe) continue;
      const team = teams.get(row.equipe) || { equipe: row.equipe, alunos: 0, pontos: 0, evolucoes: [] };
      team.alunos += 1;
      team.pontos += row.pontos;
      if (row.evolucao !== null) team.evolucoes.push(row.evolucao);
      teams.set(row.equipe, team);
    }
    const byPoints = tournament.rows[0].classificacao === "pontos";
    const equipes = [...teams.values()]
      .map(({ evolucoes, ...team }) => ({
        ...team,
        evolucao: evolucoes.length ? Math.round((evolucoes.reduce((a, b) => a + b, 0) / evolucoes.length) * 10) / 10 : null
      }))
      .sort((a, b) => byPoints ? b.pontos - a.pontos : (b.evolucao ?? -Infinity) - (a.evolucao ?? -Infinity) || b.pontos - a.pontos)
      .map((team, index) => ({ ...team, posicao: index + 1 }));

    return res.json({ torneio: { ...tournament.rows[0], id: Number(tournament.rows[0].id) }, alunos, equipes });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    // 42883: ranking function missing (migration not applied yet).
    if (error.code === "42883") {
      return res.status(404).json({ message: "tournament ranking not available" });
    }
    return res.status(500).json({ message: error.message });
  }
});

// POST /partidas — record a new match result
app.post("/partidas", async (req, res) => {
  try {
    const body = req.body || {};
    const matricula = normalizeMatricula(body);
    if (!matricula) {
      return res.status(400).json({ message: "matricula is required" });
    }

    const duracaoRaw = body.duracao !== undefined && body.duracao !== null ? Number(body.duracao) : 0;
    if (Number.isNaN(duracaoRaw) || duracaoRaw < 0) {
      return res.status(400).json({ message: "duracao must be a non-negative number" });
    }
    const duracao = Math.round(duracaoRaw * 100) / 100;
    const questoes = parseNonNegativeInt(body.questoes, "questoes") ?? 0;
    const acertos  = parseNonNegativeInt(body.acertos,  "acertos")  ?? 0;
    if (acertos > questoes) {
      return res.status(400).json({ message: "acertos must not exceed questoes" });
    }

    const tempoRaw = body.tempo !== undefined && body.tempo !== null ? Number(body.tempo) : 0;
    if (Number.isNaN(tempoRaw) || tempoRaw < 0) {
      return res.status(400).json({ message: "tempo must be a non-negative number" });
    }
    const tempo = Math.round(tempoRaw * 100) / 100;

    // duracao and tempo are NUMERIC(8,2) in flying.partidas.
    if (duracao > MAX_SECONDS || tempo > MAX_SECONDS) {
      return res.status(400).json({ message: `duracao and tempo must not exceed ${MAX_SECONDS}` });
    }

    const vitoria = body.vitoria ? 1 : 0;
    const pvp     = body.pvp     ? 1 : 0;
    // Points earned in this match (the same amount the game adds to alunos.pontos); older builds omit it.
    const pontos = parseNonNegativeInt(body.pontos, "pontos");
    const direcionamentoId = await resolveDirection(body.direcionamento_id, matricula);

    const result = (await hasDirectionSchema())
      ? await query(
          `INSERT INTO partidas (matricula, duracao, questoes, acertos, tempo, vitoria, pvp, jogo, pontos, direcionamento_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
          [matricula, duracao, questoes, acertos, tempo, vitoria, pvp, GAME_CODE, pontos, direcionamentoId]
        )
      : await query(
          `INSERT INTO partidas (matricula, duracao, questoes, acertos, tempo, vitoria, pvp, jogo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
          [matricula, duracao, questoes, acertos, tempo, vitoria, pvp, GAME_CODE]
        );

    return res.status(201).json({ id: result.insertId, matricula, pontos, direcionamento_id: direcionamentoId });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (/must be a non-negative integer/.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
});

// GET /partidas?matricula=... — fetch match history for a player
app.get("/partidas", async (req, res) => {
  try {
    const matricula = typeof req.query.matricula === "string" ? req.query.matricula.trim() : "";
    if (!matricula) {
      return res.status(400).json({ message: "matricula is required" });
    }

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

    const result = await query(
      // float8 keeps duracao/tempo as JSON numbers (NUMERIC would come back as strings).
      `SELECT id, matricula, data, duracao::float8 AS duracao, questoes, acertos, tempo::float8 AS tempo, vitoria, pvp
       FROM partidas
       WHERE matricula = ?
       ORDER BY data DESC
       LIMIT ${limit}`,
      [matricula]
    );

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// POST /habilidades — record skill performance from a match
app.post("/habilidades", async (req, res) => {
  try {
    const body = req.body || {};
    const matricula = normalizeMatricula(body);
    const habilidade = typeof body.habilidade === "string" ? body.habilidade.trim().toUpperCase() : "";

    if (!matricula) {
      return res.status(400).json({ message: "matricula is required" });
    }

    if (!habilidade) {
      return res.status(400).json({ message: "habilidade is required" });
    }

    const tentativas = parseNonNegativeInt(body.tentativas, "tentativas") ?? 0;
    const acertos = parseNonNegativeInt(body.acertos, "acertos") ?? 0;
    if (acertos > tentativas) {
      return res.status(400).json({ message: "acertos must not exceed tentativas" });
    }

    const performanceRaw = body.performance !== undefined && body.performance !== null 
      ? Number(body.performance) 
      : 0;
    
    if (Number.isNaN(performanceRaw) || performanceRaw < 0 || performanceRaw > 1) {
      return res.status(400).json({ message: "performance must be a number between 0 and 1" });
    }

    const performance = Math.round(performanceRaw * 10000) / 10000;
    const { origem, questaoId, gerador } = parseQuestionOrigin(body);
    const direcionamentoId = await resolveDirection(body.direcionamento_id, matricula);

    // One row per skill per match: flying.habilidades is an event log, and
    // atualizado_em (set by its default) is the event time. performance is
    // received as 0–1 and stored as 0–100.
    const result = (await hasDirectionSchema())
      ? await query(
          `INSERT INTO habilidades (matricula, habilidade, performance, tentativas, acertos, jogo, origem, questao_id, gerador, direcionamento_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
          [matricula, habilidade, Math.round(performance * 10000) / 100, tentativas, acertos, GAME_CODE, origem, questaoId, gerador, direcionamentoId]
        )
      : await query(
          `INSERT INTO habilidades (matricula, habilidade, performance, tentativas, acertos, jogo, origem, questao_id, gerador)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
          [matricula, habilidade, Math.round(performance * 10000) / 100, tentativas, acertos, GAME_CODE, origem, questaoId, gerador]
        );

    return res.status(201).json({
      id: result.insertId,
      matricula,
      habilidade,
      tentativas,
      acertos,
      performance,
      origem,
      questao_id: questaoId,
      gerador,
      direcionamento_id: direcionamentoId
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    // 23503: questao_id not in flying.questoes (or matricula not in alunos).
    if (error.code === "23503") {
      return res.status(400).json({ message: error.constraint === "habilidades_questao_fk" ? "questao_id not found" : "matricula not found" });
    }
    return res.status(500).json({ message: error.message });
  }
});

app.get("/questoes/random", async (req, res) => {
  try {
    const { disciplina, etapa } = req.query;
    // bncc=EF05MA08,EF05MA03 — questions with any of these codes (a question may list several, comma-separated).
    const bncc = typeof req.query.bncc === "string"
      ? [...new Set(req.query.bncc.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean))]
      : [];
    if (bncc.length > 10 || bncc.some((code) => !/^[A-Z0-9]{4,20}$/.test(code))) {
      return res.status(400).json({ message: "bncc must be up to 10 comma-separated codes" });
    }

    let whereConditions = [];
    let params = [];

    if (disciplina) {
      whereConditions.push(`disciplina = $${whereConditions.length + 1}`);
      params.push(disciplina);
    }

    if (etapa) {
      whereConditions.push(`etapa = $${whereConditions.length + 1}`);
      params.push(etapa);
    }

    if (bncc.length) {
      whereConditions.push(`string_to_array(upper(regexp_replace(bncc, '\\s', '', 'g')), ',') && $${whereConditions.length + 1}::text[]`);
      params.push(bncc);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const result = await query(`
      SELECT 
        id, questao, alternativas, resposta, imagem, bncc, 
        contexto, disciplina, etapa
      FROM questoes
      ${whereClause}
      ORDER BY RANDOM()
      LIMIT 1
    `, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No questions available for the specified filters" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Matemagos API listening on port ${port}`);
  });
}

module.exports = { app, pool };
