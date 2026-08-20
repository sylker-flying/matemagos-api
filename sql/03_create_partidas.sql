-- Migration: create partidas table
-- Records individual match results per player.

SET search_path TO flying, public;

CREATE TABLE IF NOT EXISTS partidas (
  id         BIGSERIAL PRIMARY KEY,
  matricula  VARCHAR(20)    NOT NULL,
  ticket     VARCHAR(50)    NULL,
  data       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duracao    NUMERIC(6,2)   NOT NULL DEFAULT 0,
  questoes   INT            NOT NULL DEFAULT 0,
  acertos    INT            NOT NULL DEFAULT 0,
  tempo      NUMERIC(6,2)   NOT NULL DEFAULT 0,
  vitoria    SMALLINT       NOT NULL DEFAULT 0 CHECK (vitoria IN (0, 1)),
  pvp        SMALLINT       NOT NULL DEFAULT 0 CHECK (pvp IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_partidas_matricula ON partidas (matricula);
CREATE INDEX IF NOT EXISTS idx_partidas_ticket ON partidas (ticket);
