-- Migration: drop ticket from partidas and habilidades.
-- The player's ticket lives only in alunos.ticket (validity in tickets).

SET search_path TO flying, public;

DROP INDEX IF EXISTS idx_partidas_ticket;
ALTER TABLE IF EXISTS partidas DROP COLUMN IF EXISTS ticket;
ALTER TABLE IF EXISTS habilidades DROP COLUMN IF EXISTS ticket;
