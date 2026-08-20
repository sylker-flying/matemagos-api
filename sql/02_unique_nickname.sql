SET search_path TO flying, public;

CREATE UNIQUE INDEX IF NOT EXISTS alunos_nickname_unique_idx
ON alunos ((LOWER(BTRIM(nickname))))
WHERE NULLIF(BTRIM(nickname), '') IS NOT NULL;
