-- Jogo e origem de cada resposta em flying.habilidades (e jogo de cada partida em flying.partidas).
--   jogo:       qual jogo registrou a linha (catálogo em flying.jogos). Hoje só existe o Matemagos.
--   origem:     acervo (questão de flying.questoes, em questao_id) ou gerada (algoritmo do jogo, em gerador).
-- Linhas antigas ficam com jogo = matemagos e origem vazia; continuam valendo só pelo código BNCC de habilidade.
-- Pode ser executada pelo dono das tabelas (flying_app). Seguro repetir.
-- DBeaver: rode o arquivo inteiro com Execute SQL Script (Alt+X / ⌥X), numa conexão de escrita.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS flying.jogos (
  codigo varchar(40) PRIMARY KEY CONSTRAINT jogos_codigo_valido CHECK (codigo ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  nome varchar(80) NOT NULL CONSTRAINT jogos_nome_nao_vazio CHECK (btrim(nome) <> ''),
  criado_em timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO flying.jogos (codigo, nome) VALUES ('matemagos', 'Matemagos') ON CONFLICT (codigo) DO NOTHING;

-- O valor padrão marca todas as linhas existentes como Matemagos sem reescrever a tabela nem disparar
-- os gatilhos de atualizado_em (a data da resposta). Ele fica enquanto o Matemagos for o único jogo
-- gravando; cada jogo novo deve informar a coluna, e o padrão sai quando o segundo jogo entrar.
ALTER TABLE flying.habilidades
  ADD COLUMN IF NOT EXISTS jogo varchar(40) NOT NULL DEFAULT 'matemagos',
  ADD COLUMN IF NOT EXISTS origem varchar(10),
  ADD COLUMN IF NOT EXISTS questao_id bigint,
  ADD COLUMN IF NOT EXISTS gerador varchar(40);
ALTER TABLE flying.partidas
  ADD COLUMN IF NOT EXISTS jogo varchar(40) NOT NULL DEFAULT 'matemagos';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'flying.habilidades'::regclass AND conname = 'habilidades_jogo_fk') THEN
    ALTER TABLE flying.habilidades ADD CONSTRAINT habilidades_jogo_fk
      FOREIGN KEY (jogo) REFERENCES flying.jogos (codigo) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'flying.partidas'::regclass AND conname = 'partidas_jogo_fk') THEN
    ALTER TABLE flying.partidas ADD CONSTRAINT partidas_jogo_fk
      FOREIGN KEY (jogo) REFERENCES flying.jogos (codigo) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  -- Uma questão já respondida não pode ser apagada; desative-a em vez disso.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'flying.habilidades'::regclass AND conname = 'habilidades_questao_fk') THEN
    ALTER TABLE flying.habilidades ADD CONSTRAINT habilidades_questao_fk
      FOREIGN KEY (questao_id) REFERENCES flying.questoes (id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  -- acervo: questao_id obrigatório, sem gerador. gerada: gerador obrigatório, sem questao_id. Vazio: linha anterior à mudança.
  -- CASE, e não OR: num CHECK, uma comparação com NULL resulta em NULL e deixaria a linha passar.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'flying.habilidades'::regclass AND conname = 'habilidades_origem_valida') THEN
    ALTER TABLE flying.habilidades ADD CONSTRAINT habilidades_origem_valida CHECK (
      CASE origem
        WHEN 'acervo' THEN questao_id IS NOT NULL AND gerador IS NULL
        WHEN 'gerada' THEN questao_id IS NULL AND gerador IS NOT NULL AND gerador ~ '^[a-z0-9][a-z0-9_.-]{0,39}$'
        ELSE origem IS NULL AND questao_id IS NULL AND gerador IS NULL
      END
    );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS habilidades_questao_idx ON flying.habilidades (questao_id) WHERE questao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS habilidades_jogo_idx ON flying.habilidades (jogo);
CREATE INDEX IF NOT EXISTS partidas_jogo_idx ON flying.partidas (jogo);

COMMENT ON TABLE flying.jogos IS
  'Jogos que registram respostas e partidas. codigo em minúsculas, sem espaços (ex.: matemagos); nome é o que aparece nos painéis.';
COMMENT ON COLUMN flying.habilidades.jogo IS
  'Jogo que registrou a resposta (flying.jogos). Linhas anteriores a 2026-11-25 são do Matemagos.';
COMMENT ON COLUMN flying.partidas.jogo IS
  'Jogo da partida (flying.jogos). Linhas anteriores a 2026-11-25 são do Matemagos.';
COMMENT ON COLUMN flying.habilidades.origem IS
  'De onde veio a questão respondida: acervo (flying.questoes) ou gerada (algoritmo do jogo). Vazio nas linhas anteriores a 2026-11-25.';
COMMENT ON COLUMN flying.habilidades.questao_id IS
  'Questão do acervo respondida (flying.questoes.id). Preenchido só quando origem = acervo.';
COMMENT ON COLUMN flying.habilidades.gerador IS
  'Algoritmo do jogo que gerou a questão, em minúsculas e com versão (ex.: fracoes-equivalentes-v1). Preenchido só quando origem = gerada.';

COMMIT;
