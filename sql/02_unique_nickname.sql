-- MySQL replacement for PostgreSQL partial functional unique index:
-- Enforces unique nickname ignoring case/whitespace and ignores blank values.

SET @schema_name := DATABASE();

SET @has_normalized_column := (
	SELECT COUNT(*)
	FROM information_schema.COLUMNS
	WHERE TABLE_SCHEMA = @schema_name
		AND TABLE_NAME = 'alunos'
		AND COLUMN_NAME = 'nickname_normalized'
);

SET @sql_stmt := IF(
	@has_normalized_column = 0,
	'ALTER TABLE alunos ADD COLUMN nickname_normalized VARCHAR(80) GENERATED ALWAYS AS (NULLIF(LOWER(TRIM(nickname)), '''')) STORED',
	'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_unique_index := (
	SELECT COUNT(*)
	FROM information_schema.STATISTICS
	WHERE TABLE_SCHEMA = @schema_name
		AND TABLE_NAME = 'alunos'
		AND INDEX_NAME = 'alunos_nickname_unique_idx'
);

SET @sql_stmt := IF(
	@has_unique_index = 0,
	'ALTER TABLE alunos ADD UNIQUE KEY alunos_nickname_unique_idx (nickname_normalized)',
	'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
