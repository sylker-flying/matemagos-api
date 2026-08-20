-- Create habilidades table to track skill performance per student

SET search_path TO flying, public;

CREATE TABLE IF NOT EXISTS habilidades (
  id BIGSERIAL PRIMARY KEY,
  matricula VARCHAR(255) NOT NULL,
  ticket VARCHAR(64),
  habilidade VARCHAR(16) NOT NULL,
  performance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  tentativas INT NOT NULL DEFAULT 0,
  acertos INT NOT NULL DEFAULT 0,
  data TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_habilidade UNIQUE (matricula, habilidade),
  FOREIGN KEY (matricula) REFERENCES alunos(matricula) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_performance
ON habilidades (matricula, habilidade, performance);

CREATE INDEX IF NOT EXISTS idx_data
ON habilidades (data);
