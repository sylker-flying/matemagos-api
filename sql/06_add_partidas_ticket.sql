-- Migration: add ticket column to partidas if it does not exist

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'partidas'
    AND column_name = 'ticket'
);

SET @stmt := IF(
  @col_exists = 0,
  'ALTER TABLE partidas ADD COLUMN ticket VARCHAR(50) NULL AFTER matricula, ADD INDEX idx_partidas_ticket (ticket)',
  'SELECT 1'
);

PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
