# 0004. Acesso a dados com SQL puro (`pg`), sem ORM

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0019, PERF-04, PERF-06, PERF-08, PERF-09, SEC-09

## Contexto

O núcleo do sistema é concorrência: `SELECT ... FOR UPDATE` em ordem, `FOR UPDATE SKIP LOCKED`, `ON CONFLICT`, `lock_timeout`. O que roda no banco precisa ser exatamente o que aparece no code review.

## Opções consideradas

1. **Prisma**: client tipado e migrations declarativas, mas locks exigem `$queryRaw` e o modelo de transação é próprio
2. **TypeORM**: comum em Nest corporativo e com lock pessimista nativo, mas o SQL gerado fica implícito e há quirks com locks + joins
3. **SQL puro com `pg` (node-postgres)**: controle total, sem camada intermediária

## Decisão

SQL puro com `pg`. Repositórios (`PgAccountRepository` etc.) escrevem SQL parametrizado e mapeiam linhas com `toDomain(row)`. `packages/database` centraliza pool, `withTransaction` (com `SET LOCAL lock_timeout/statement_timeout`), `UnitOfWork` via `AsyncLocalStorage` e o parser de `int8` → `bigint`.

## Consequências

- Positivas: locks e transações explícitos e revisáveis; sem surpresa de SQL gerado; bom material de entrevista.
- Custos: mapeamento manual; o compilador não verifica as linhas, então testes de integração com Testcontainers são obrigatórios; risco de SQL injection mitigado por lint e só `$n`.
- Revisitar: se o volume de CRUD simples crescer muito (considerar um query builder tipado como Kysely, sem virar ORM).
