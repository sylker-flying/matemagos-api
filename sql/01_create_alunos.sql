CREATE TABLE IF NOT EXISTS public.alunos (
    id BIGSERIAL PRIMARY KEY,
    matricula VARCHAR(50) NOT NULL UNIQUE,
    nome VARCHAR(120) NOT NULL,
    nickname VARCHAR(80),
    avatar TEXT,
    sexo CHAR(1) CHECK (sexo IN ('M', 'F', 'O')),
    nascimento DATE,
    escola VARCHAR(120),
    ano SMALLINT,
    turma VARCHAR(20),
    vitorias INTEGER NOT NULL DEFAULT 0 CHECK (vitorias >= 0),
    derrotas INTEGER NOT NULL DEFAULT 0 CHECK (derrotas >= 0),
    acertos INTEGER NOT NULL DEFAULT 0 CHECK (acertos >= 0),
    erros INTEGER NOT NULL DEFAULT 0 CHECK (erros >= 0),
    progresso NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progresso >= 0 AND progresso <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS alunos_nickname_unique_idx
ON public.alunos (LOWER(BTRIM(nickname)))
WHERE nickname IS NOT NULL AND BTRIM(nickname) <> '';
