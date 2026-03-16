-- Migration: create partidas table
-- Records individual match results per player.

CREATE TABLE IF NOT EXISTS partidas (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  matricula  VARCHAR(20)    NOT NULL,
  data       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duracao    DECIMAL(6,2)   NOT NULL DEFAULT 0,   -- match duration in seconds
  questoes   INT            NOT NULL DEFAULT 0,   -- total questions presented
  acertos    INT            NOT NULL DEFAULT 0,   -- correct answers
  tempo      DECIMAL(6,2)   NOT NULL DEFAULT 0,   -- average seconds per question
  vitoria    TINYINT(1)     NOT NULL DEFAULT 0,   -- 1 = won, 0 = lost/draw
  pvp        TINYINT(1)     NOT NULL DEFAULT 0,   -- 1 = PvP, 0 = PvE
  INDEX idx_partidas_matricula (matricula)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
