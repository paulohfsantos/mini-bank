-- Só local (docker-compose): roda uma vez, quando o volume do Postgres é criado.
-- Cria os usuários de aplicação com LOGIN e senha de desenvolvimento. Os GRANTs vêm da
-- migration 0002 (que só cria os papéis se ainda não existirem). Na AWS as senhas vêm
-- do Secrets Manager (fase 6), nunca deste arquivo.
CREATE ROLE mini_banco_api LOGIN PASSWORD 'api-local';
CREATE ROLE mini_banco_worker LOGIN PASSWORD 'worker-local';
