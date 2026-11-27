// Run against a disposable copy of the Flying database with migration 20261127_direcionamentos.sql applied:
//   TEST_DATABASE_URL=postgresql://... npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("Set TEST_DATABASE_URL to a disposable copy of the Flying database.");
}
process.env.DATABASE_URL = url;
process.env.DB_SCHEMA = "flying";
const { app, pool } = require("../src/server");

let server;
let base;
let matricula;
let other;
const ids = {};

const call = async (method, path, body) => {
  const response = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() };
};
const direction = async (fields) => {
  const { rows } = await pool.query(
    `INSERT INTO flying.direcionamentos (intervencao, acao, tipo, nome, jogo, modo, peso, classificacao, inicio, fim, ativo)
     VALUES ('teste-api', $1, $2, $3, $4, $5, $6, $7, now() + $8::interval, now() + $9::interval, $10) RETURNING id`,
    [fields.acao, fields.tipo ?? "missao", fields.nome ?? null, fields.jogo ?? null, fields.modo ?? null, fields.peso ?? 0.5,
     fields.classificacao ?? null, fields.inicio ?? "-1 day", fields.fim ?? "7 days", fields.ativo ?? true]
  );
  const id = Number(rows[0].id);
  await pool.query("INSERT INTO flying.direcionamento_habilidades VALUES ($1, 'bncc', 'EF05MA08'), ($1, 'saeb', 'D3')", [id]);
  await pool.query("INSERT INTO flying.direcionamento_alunos (direcionamento, matricula, equipe) VALUES ($1, $2, $3)", [id, matricula, fields.equipe ?? null]);
  return id;
};

before(async () => {
  const { rows } = await pool.query("SELECT matricula FROM flying.alunos ORDER BY id LIMIT 2");
  [matricula, other] = rows.map((r) => r.matricula);
  await pool.query("DELETE FROM flying.direcionamentos WHERE intervencao = 'teste-api'");
  ids.missao = await direction({ acao: "teste-api-missao" });
  ids.torneio = await direction({ acao: "teste-api-torneio", tipo: "torneio", nome: "Torneio da turma 5ºA", modo: "pvp", peso: 1, classificacao: "equipes", equipe: "Equipe A" });
  ids.encerrado = await direction({ acao: "teste-api-encerrado", inicio: "-10 days", fim: "-3 days" });
  ids.inativo = await direction({ acao: "teste-api-inativo", ativo: false });
  ids.outroJogo = await direction({ acao: "teste-api-outro-jogo", jogo: "matemagos" });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await pool.query("DELETE FROM flying.habilidades WHERE direcionamento_id IN (SELECT id FROM flying.direcionamentos WHERE intervencao = 'teste-api')");
  await pool.query("DELETE FROM flying.partidas WHERE direcionamento_id IN (SELECT id FROM flying.direcionamentos WHERE intervencao = 'teste-api') OR (matricula = $1 AND pontos = 77)", [matricula]);
  await pool.query("DELETE FROM flying.direcionamentos WHERE intervencao = 'teste-api'");
  server.close();
  await pool.end();
});

test("lista só os direcionamentos vigentes do aluno, com as habilidades BNCC à parte", async () => {
  const { status, body } = await call("GET", `/direcionamentos/${encodeURIComponent(matricula)}`);
  assert.equal(status, 200);
  assert.deepEqual(body.map((d) => d.id).sort(), [ids.missao, ids.torneio, ids.outroJogo].sort());
  const torneio = body.find((d) => d.id === ids.torneio);
  assert.equal(torneio.tipo, "torneio");
  assert.equal(torneio.peso, 1);
  assert.equal(torneio.equipe, "Equipe A");
  assert.deepEqual(torneio.bncc, ["EF05MA08"]);
  assert.equal(torneio.habilidades.length, 2);
  // In individual mode the PvP tournament does not apply.
  const individual = await call("GET", `/direcionamentos/${encodeURIComponent(matricula)}?modo=individual`);
  assert.ok(!individual.body.some((d) => d.id === ids.torneio));
  assert.equal((await call("GET", `/direcionamentos/${encodeURIComponent(other)}`)).body.length, 0);
  assert.equal((await call("GET", `/direcionamentos/${encodeURIComponent(matricula)}?modo=x`)).status, 400);
});

test("a partida grava pontos e o direcionamento quando ele vale para o aluno", async () => {
  const ok = await call("POST", "/partidas", { matricula, questoes: 10, acertos: 7, pvp: true, vitoria: true, pontos: 100, direcionamento_id: ids.torneio });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.direcionamento_id, ids.torneio);
  const { rows } = await pool.query("SELECT pontos, direcionamento_id FROM flying.partidas WHERE id = $1", [ok.body.id]);
  assert.deepEqual({ pontos: rows[0].pontos, direcionamento_id: Number(rows[0].direcionamento_id) }, { pontos: 100, direcionamento_id: ids.torneio });
  // Ended, inactive or someone else's direction: the match is kept, without the direction.
  for (const id of [ids.encerrado, ids.inativo]) {
    const kept = await call("POST", "/partidas", { matricula, questoes: 1, acertos: 1, pontos: 77, direcionamento_id: id });
    assert.equal(kept.status, 201);
    assert.equal(kept.body.direcionamento_id, null);
  }
  const notMine = await call("POST", "/partidas", { matricula: other, questoes: 1, acertos: 1, pontos: 77, direcionamento_id: ids.missao });
  assert.equal(notMine.body.direcionamento_id, null);
  await pool.query("DELETE FROM flying.partidas WHERE id = $1", [notMine.body.id]);
  assert.equal((await call("POST", "/partidas", { matricula, pontos: -1 })).status, 400);
  assert.equal((await call("POST", "/partidas", { matricula, direcionamento_id: "abc" })).status, 400);
});

test("a resposta por habilidade grava o direcionamento", async () => {
  const ok = await call("POST", "/habilidades", { matricula, habilidade: "EF05MA08", tentativas: 3, acertos: 2, performance: 0.6667, gerador: "fracoes-v1", direcionamento_id: ids.missao });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.direcionamento_id, ids.missao);
  const old = await call("POST", "/habilidades", { matricula, habilidade: "EF05MA08", tentativas: 1, acertos: 1, performance: 1, gerador: "fracoes-v1" });
  assert.equal(old.body.direcionamento_id, null);
  await pool.query("DELETE FROM flying.habilidades WHERE id = $1", [old.body.id]);
});

test("o acervo filtra questões por código BNCC", async () => {
  const { rows } = await pool.query("SELECT bncc FROM flying.questoes WHERE bncc IS NOT NULL AND bncc <> '' LIMIT 1");
  if (!rows.length) return;
  const code = rows[0].bncc.split(",")[0].trim();
  const found = await call("GET", `/questoes/random?bncc=${encodeURIComponent(code.toLowerCase())},EF99XX99`);
  assert.equal(found.status, 200);
  assert.ok(found.body.bncc.toUpperCase().includes(code.toUpperCase()));
  assert.equal((await call("GET", "/questoes/random?bncc=EF99XX99")).status, 404);
  assert.equal((await call("GET", "/questoes/random?bncc=nao%20vale")).status, 400);
});

test("o ranking do torneio vem da função do Flying e só para participantes", async () => {
  await call("POST", "/habilidades", { matricula, habilidade: "EF05MA08", tentativas: 6, acertos: 5, performance: 0.8333, gerador: "fracoes-v1", direcionamento_id: ids.torneio });
  const { status, body } = await call("GET", `/torneios/${ids.torneio}/ranking?matricula=${encodeURIComponent(matricula)}`);
  assert.equal(status, 200);
  assert.equal(body.torneio.nome, "Torneio da turma 5ºA");
  assert.equal(body.alunos.length, 1);
  const me = body.alunos[0];
  assert.equal(me.eu, true);
  assert.equal(me.matricula, undefined);
  assert.equal(me.pontos, 100);
  assert.equal(me.respostas, 6);
  assert.equal(me.posicao, 1);
  assert.deepEqual(body.equipes.map((e) => [e.equipe, e.alunos, e.posicao]), [["Equipe A", 1, 1]]);
  assert.equal((await call("GET", `/torneios/${ids.torneio}/ranking?matricula=${encodeURIComponent(other)}`)).status, 404);
  assert.equal((await call("GET", `/torneios/${ids.missao}/ranking?matricula=${encodeURIComponent(matricula)}`)).status, 404);
  assert.equal((await call("GET", `/torneios/${ids.torneio}/ranking`)).status, 400);
});
