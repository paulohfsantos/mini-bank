-- migrate:up
-- Usuários de aplicação com menor privilégio (defesa em profundidade: limita o raio de
-- uma eventual SQL injection, SEC-09). A migration cria os papéis sem
-- LOGIN e concede só o DML necessário; a senha e o LOGIN são definidos fora do git:
--   local: infra/local/postgres-init.sql (docker-compose)
--   AWS:   task de migrate com senhas do Secrets Manager (fase 6)
-- Papéis são globais no cluster, por isso o IF NOT EXISTS (um banco por worker de teste).
SET lock_timeout = '3s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mini_banco_api') THEN
    CREATE ROLE mini_banco_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mini_banco_worker') THEN
    CREATE ROLE mini_banco_worker NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mini_banco_api, mini_banco_worker;

-- API: contas, transferências, ledger e idempotência; outbox inclui o relay e a limpeza.
-- Sem DELETE em accounts/transfers/ledger_entries: o histórico financeiro é append-only.
GRANT SELECT, INSERT, UPDATE         ON accounts         TO mini_banco_api;
GRANT SELECT, INSERT                 ON transfers        TO mini_banco_api;
GRANT SELECT, INSERT                 ON ledger_entries   TO mini_banco_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO mini_banco_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON outbox           TO mini_banco_api;

-- Worker: só lê transferências (validação do evento e regra de velocidade) e escreve
-- os próprios resultados. Não enxerga accounts (CPF) nem o ledger.
GRANT SELECT         ON transfers          TO mini_banco_worker;
GRANT SELECT, INSERT ON fraud_reviews      TO mini_banco_worker;
GRANT SELECT, INSERT ON notifications      TO mini_banco_worker;
GRANT SELECT, INSERT ON processed_messages TO mini_banco_worker;

-- migrate:down
SET lock_timeout = '3s';
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mini_banco_api, mini_banco_worker;
REVOKE USAGE ON SCHEMA public FROM mini_banco_api, mini_banco_worker;
-- Os papéis ficam: podem existir em outros bancos do mesmo cluster.
