CREATE SCHEMA IF NOT EXISTS flying;
SET search_path TO flying, public;

CREATE TABLE IF NOT EXISTS alunos (
    id BIGSERIAL PRIMARY KEY,
    matricula VARCHAR(50) NOT NULL UNIQUE,
    nome VARCHAR(120),
    nickname VARCHAR(80),
    avatar TEXT,
    sexo CHAR(1),
    nascimento DATE,
    escola VARCHAR(120),
    ano SMALLINT,
    turma VARCHAR(20),
    partidas_pve INT NOT NULL DEFAULT 0,
    partidas_pvp INT NOT NULL DEFAULT 0,
    vitorias_pve INT NOT NULL DEFAULT 0,
    vitorias_pvp INT NOT NULL DEFAULT 0,
    questoes INT NOT NULL DEFAULT 0,
    acertos INT NOT NULL DEFAULT 0,
    pontos INT NOT NULL DEFAULT 0,
    progresso NUMERIC(5,2) NOT NULL DEFAULT 0,
    device VARCHAR(120),
    ticket VARCHAR(120),
    validade TIMESTAMP,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS alunos_set_atualizado_em ON alunos;

CREATE TRIGGER alunos_set_atualizado_em
BEFORE UPDATE ON alunos
FOR EACH ROW
EXECUTE FUNCTION set_atualizado_em();
