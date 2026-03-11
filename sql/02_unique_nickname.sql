CREATE UNIQUE INDEX IF NOT EXISTS alunos_nickname_unique_idx
ON public.alunos (LOWER(BTRIM(nickname)))
WHERE nickname IS NOT NULL AND BTRIM(nickname) <> '';