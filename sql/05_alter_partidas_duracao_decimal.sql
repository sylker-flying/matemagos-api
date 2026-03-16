-- Migration: ensure partidas.duracao supports decimal values

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'partidas'
    AND column_name = 'duracao'
);

SET @stmt := IF(
  @col_exists > 0,
  'ALTER TABLE partidas MODIFY COLUMN duracao DECIMAL(6,2) NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
