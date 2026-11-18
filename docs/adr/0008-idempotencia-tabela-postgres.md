# 0008. Idempotência com tabela no Postgres na mesma transação

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** TRF-AC-04..06, TRF-AC-13, TRF-AC-16, PERF-07, SEC-10, SEC-11

## Contexto

`POST /v1/transfers` exige `Idempotency-Key`. Retries e duplo clique não podem gerar duas transferências, inclusive sob concorrência.

## Opções consideradas

1. **Redis com SETNX**: rápido, mas fora da transação: falha entre Redis e Postgres gera inconsistência
2. **Tabela `idempotency_keys` na mesma transação**: atomicidade com a transferência

## Decisão

Tabela `idempotency_keys` com PK `(client_id, key)`. O INSERT da chave é o primeiro passo da transação: uma concorrente bloqueia no índice único (limitado por `lock_timeout`, respondendo 409 `REQUEST_IN_PROGRESS`). Hash SHA-256 do payload canônico: mesmo payload devolve a resposta salva (`Idempotent-Replayed: true`); payload diferente devolve 422. Expiração de 24 h e job de limpeza.

## Consequências

- Positivas: correção garantida pelo banco; sem infraestrutura extra.
- Custos: carga extra de escrita no Postgres; tabela precisa de limpeza.
- Revisitar: em volumes muito altos, particionar por data.
