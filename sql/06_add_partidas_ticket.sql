-- Migration: add ticket column to partidas if it does not exist

SET search_path TO flying, public;

ALTER TABLE IF EXISTS partidas
ADD COLUMN IF NOT EXISTS ticket VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_partidas_ticket ON partidas (ticket);
