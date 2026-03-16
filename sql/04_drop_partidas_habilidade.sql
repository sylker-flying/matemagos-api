-- Migration: drop habilidade column from partidas if it exists

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'partidas'
    AND column_name = 'habilidade'
);

SET @stmt := IF(
  @col_exists > 0,
  'ALTER TABLE partidas DROP COLUMN habilidade',
  'SELECT 1'
);

PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
