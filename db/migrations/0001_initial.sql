-- migrate:up
-- Esquema inicial (docs/README.md §3.3). IDs são UUIDv7 gerados na aplicação (PERF-10),
-- então nenhuma coluna usa DEFAULT gen_random_uuid().
-- Datas em timestamptz; dinheiro em bigint de centavos (ADR-0009).
-- `updated_at` é mantido pela aplicação no próprio UPDATE (sem trigger).
SET lock_timeout = '3s'; -- PERF-15: falha rápido em vez de enfileirar atrás de um lock longo

CREATE TABLE accounts (
  id            uuid        PRIMARY KEY,
  holder_name   text        NOT NULL CHECK (char_length(holder_name) BETWEEN 1 AND 120),
  document      char(11)    NOT NULL CHECK (document ~ '^[0-9]{11}$'),
  balance_cents bigint      NOT NULL CHECK (balance_cents >= 0), -- TRF-BR-03: última linha de defesa
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_document_key UNIQUE (document) -- ACC-BR-05
);

CREATE TABLE transfers (
  id                     uuid        PRIMARY KEY,
  source_account_id      uuid        NOT NULL REFERENCES accounts (id),
  destination_account_id uuid        NOT NULL REFERENCES accounts (id),
  amount_cents           bigint      NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000), -- TRF-BR-01
  status                 text        NOT NULL CHECK (status IN ('COMPLETED')),
  correlation_id         text        NOT NULL CHECK (char_length(correlation_id) BETWEEN 1 AND 64),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfers_distinct_accounts CHECK (source_account_id <> destination_account_id) -- TRF-BR-02
);
-- Regra de velocidade do antifraude (PRC-BR) e extrato por origem (PERF-11).
CREATE INDEX transfers_source_created_idx ON transfers (source_account_id, created_at);
-- O Postgres não indexa FKs sozinho.
CREATE INDEX transfers_destination_idx ON transfers (destination_account_id);

CREATE TABLE ledger_entries (
  id                  uuid        PRIMARY KEY,
  account_id          uuid        NOT NULL REFERENCES accounts (id),
  transfer_id         uuid        REFERENCES transfers (id),
  type                text        NOT NULL CHECK (type IN ('OPENING', 'DEBIT', 'CREDIT')),
  amount_cents        bigint      NOT NULL CHECK (amount_cents >= 0),
  balance_after_cents bigint      NOT NULL CHECK (balance_after_cents >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Abertura não tem transferência; débito e crédito sempre têm, com valor positivo.
  CONSTRAINT ledger_entries_transfer_matches_type CHECK (
    (type = 'OPENING' AND transfer_id IS NULL)
    OR (type IN ('DEBIT', 'CREDIT') AND transfer_id IS NOT NULL AND amount_cents > 0)
  )
);
-- Keyset pagination do extrato (ADR-0016): mesma ordem do ORDER BY.
CREATE INDEX ledger_entries_account_keyset_idx
  ON ledger_entries (account_id, created_at DESC, id DESC);
-- Um DEBIT e um CREDIT por transferência e conta (TRF-BR-04).
CREATE UNIQUE INDEX ledger_entries_transfer_type_key
  ON ledger_entries (transfer_id, type) WHERE transfer_id IS NOT NULL;

-- Idempotência (ADR-0008). A linha é inserida no início da transação e completada no fim;
-- como só respostas 201 são gravadas (TRF-BR-11) e falhas fazem rollback, toda linha
-- commitada tem transfer_id e resposta preenchidos.
CREATE TABLE idempotency_keys (
  client_id       text        NOT NULL,
  key             text        NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{1,64}$'),
  request_hash    char(64)    NOT NULL, -- SHA-256 hex do payload canônico
  transfer_id     uuid        REFERENCES transfers (id),
  response_status smallint,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  PRIMARY KEY (client_id, key)
);
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at); -- job de limpeza

-- Transactional outbox (ADR-0006). id = eventId do evento publicado.
CREATE TABLE outbox (
  id             uuid        PRIMARY KEY,
  aggregate_id   uuid        NOT NULL,
  event_type     text        NOT NULL,
  payload        jsonb       NOT NULL,
  correlation_id text        NOT NULL,
  traceparent    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  claimed_until  timestamptz,
  published_at   timestamptz,
  attempts       integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text
);
-- O relay só olha linhas pendentes: índice parcial pequeno mesmo com milhões de publicadas.
CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE published_at IS NULL;
CREATE INDEX outbox_published_idx ON outbox (published_at) WHERE published_at IS NOT NULL; -- limpeza (PERF-12)

-- Worker (fase 3): antifraude, notificações e deduplicação de mensagens.
CREATE TABLE fraud_reviews (
  id           uuid        PRIMARY KEY,
  transfer_id  uuid        NOT NULL REFERENCES transfers (id),
  status       text        NOT NULL CHECK (status IN ('FLAGGED', 'CLEARED')),
  reasons      text[]      NOT NULL DEFAULT '{}',
  rule_version text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fraud_reviews_transfer_key UNIQUE (transfer_id)
);

CREATE TABLE notifications (
  id          uuid        PRIMARY KEY,
  transfer_id uuid        NOT NULL REFERENCES transfers (id),
  account_id  uuid        NOT NULL REFERENCES accounts (id),
  type        text        NOT NULL CHECK (type IN ('TRANSFER_SENT', 'TRANSFER_RECEIVED')),
  channel     text        NOT NULL CHECK (channel IN ('LOG')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_transfer_account_type_key UNIQUE (transfer_id, account_id, type)
);

CREATE TABLE processed_messages (
  consumer     text        NOT NULL,
  event_id     uuid        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- migrate:down
SET lock_timeout = '3s';
DROP TABLE processed_messages;
DROP TABLE notifications;
DROP TABLE fraud_reviews;
DROP TABLE outbox;
DROP TABLE idempotency_keys;
DROP TABLE ledger_entries;
DROP TABLE transfers;
DROP TABLE accounts;
