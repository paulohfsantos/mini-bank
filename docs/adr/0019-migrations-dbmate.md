# 0019. Migrations em SQL puro com dbmate

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0004, PERF-15

## Contexto

Sem ORM, precisamos de uma ferramenta de migrations que rode igual no local, nos testes (Testcontainers) e na task ECS de migration.

## Opções consideradas

1. **Flyway**: muito comum em bancos, mas traz a JVM para um projeto Node
2. **node-pg-migrate**: Node nativo, migrations em JS/TS
3. **dbmate**: binário único (disponível via npm), arquivos `.sql` com `-- migrate:up` / `-- migrate:down`

## Decisão

dbmate, com migrations em `db/migrations/` e `db/schema.sql` gerado e versionado. Regras: `SET lock_timeout` no topo de toda migration, `CREATE INDEX CONCURRENTLY` com `transaction:false`, mudanças expand/contract e nunca `DROP` na mesma release que remove o uso.

## Consequências

- Positivas: SQL puro revisável; diff de schema visível em PR.
- Custos: rollback manual em produção (down migrations servem ao desenvolvimento).
- Revisitar: se o time-alvo padronizar Flyway, a migração é direta (são arquivos SQL).
