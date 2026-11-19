#!/usr/bin/env bash
# Gera db/schema.sql (versionado para revisar o diff do esquema em PRs; ADR-0019).
# Usa o pg_dump de dentro do container do compose: mesma versão do servidor e nada
# para instalar no host.
set -euo pipefail
cd "$(dirname "$0")/.."

{
  echo "-- Gerado por scripts/db-dump-schema.sh após pnpm db:migrate. Não editar à mão."
  docker compose exec -T postgres pg_dump --schema-only --no-owner --no-privileges \
    --exclude-table=schema_migrations -U minibanco minibanco \
    | grep -vE '^(-- Dumped|\\restrict|\\unrestrict|SET |SELECT pg_catalog\.set_config)' \
    | cat -s
  echo
  echo "-- Migrations aplicadas:"
  docker compose exec -T postgres psql -U minibanco -d minibanco -At \
    -c "SELECT '-- ' || version FROM schema_migrations ORDER BY version"
} > db/schema.sql

echo "db/schema.sql atualizado"
