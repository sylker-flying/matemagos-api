-- Migration: duracao and tempo with decimals (seconds).
-- Same migration as banco-sylker/migrations/20261111_partidas_duracao_tempo_decimal.sql.

SET search_path TO flying, public;

ALTER TABLE partidas
  ALTER COLUMN duracao TYPE NUMERIC(8,2),
  ALTER COLUMN duracao SET DEFAULT 0,
  ALTER COLUMN tempo TYPE NUMERIC(8,2),
  ALTER COLUMN tempo SET DEFAULT 0;
