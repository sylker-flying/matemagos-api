-- Migration: drop habilidade column from partidas if it exists

SET search_path TO flying, public;

ALTER TABLE IF EXISTS partidas
DROP COLUMN IF EXISTS habilidade;
