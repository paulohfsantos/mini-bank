## O que muda

<!-- Uma ou duas frases. -->

## Specs, ACs e riscos afetados

<!-- Ex.: specs/transfers/spec.md — TRF-AC-04, TRF-AC-05; risco PERF-07. "Nenhum" se for só infraestrutura de dev. -->

- Spec alterada antes do código? [ ] sim [ ] não se aplica
- Contrato (`specs/openapi.yaml` / `specs/events/`) alterado? [ ] sim [ ] não

## Como foi verificado

- [ ] `pnpm check` (lint, format, typecheck, test, specs) verde
- [ ] `pnpm test:integration` e `pnpm test:e2e` verdes (se tocou API, SQL ou contrato)
- [ ] Cada AC novo/alterado tem teste que cita o ID
- [ ] Testado manualmente (descreva):

## Precisa de revisão humana

<!-- Obrigatório quando houver: SQL de lock/isolamento, migrations, políticas IAM,
     tratamento de dinheiro, segurança/PII, desvio da spec. Diga exatamente o que olhar. -->

## Migrations

- [ ] Não há migration
- [ ] Migration retrocompatível (expand/contract), com `lock_timeout` e `CONCURRENTLY` quando cria índice (PERF-15)
