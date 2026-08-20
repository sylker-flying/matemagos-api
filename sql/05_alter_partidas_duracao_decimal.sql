-- Migration: ensure partidas.duracao supports decimal values

SET search_path TO flying, public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'partidas'
      AND column_name = 'duracao'
  ) THEN
    ALTER TABLE partidas
      ALTER COLUMN duracao TYPE NUMERIC(6,2),
      ALTER COLUMN duracao SET DEFAULT 0;
  END IF;
END $$;
