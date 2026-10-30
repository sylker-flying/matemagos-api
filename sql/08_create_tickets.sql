SET search_path TO flying, public;

-- Ticket expiration now lives here; alunos.ticket references tickets.nome.
-- alunos.validade is no longer read by the API.
CREATE TABLE IF NOT EXISTS tickets (
    nome VARCHAR(120) PRIMARY KEY,
    validade TIMESTAMP
);
