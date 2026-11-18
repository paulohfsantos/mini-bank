# Spec: Extrato (`STM`)

- **Status:** Aprovada para implementação (fase 2)
- **Contrato:** [`openapi.yaml`](../openapi.yaml) → `GET /v1/accounts/{accountId}/statement`; schemas `StatementPage`, `StatementEntry`
- **ADR:** 0016 (paginação keyset)

## Contexto

O extrato lista os lançamentos do ledger de uma conta, do mais recente para o mais antigo, com paginação por cursor. É a visão que o titular usa para conferir movimentações; precisa ser estável enquanto novas transferências acontecem.

## Regras de negócio

- **STM-BR-01: Fonte.** O extrato lê `ledger_entries` da conta: `OPENING`, `DEBIT` e `CREDIT`.
- **STM-BR-02: Ordem.** Decrescente por `(createdAt, id)`; `id` (UUIDv7) desempata lançamentos no mesmo instante.
- **STM-BR-03: Valores.** `amountCents` é sempre positivo; o sentido vem de `type`. `balanceAfterCents` é o saldo da conta logo após o lançamento.
- **STM-BR-04: Contraparte.** Para `DEBIT`/`CREDIT`, `transferId` e `counterpartyAccountId` são preenchidos; para `OPENING`, ambos são `null`.
- **STM-BR-05: Página.** `limit` padrão 20, mínimo 1, máximo 100.
- **STM-BR-06: Cursor opaco.** `nextCursor` é uma string base64url opaca que codifica a posição `(createdAt, id)` do último item da página; `null` na última página. O cliente não deve interpretá-la. O servidor a decodifica com validação estrita e ela nunca autoriza nada: a conta vem do path (`SEC-16`).
- **STM-BR-07: Garantia de consistência.** Lançamentos já commitados quando a primeira página foi lida aparecem exatamente uma vez ao percorrer todas as páginas, mesmo com novos lançamentos chegando. Limitação documentada (ADR-0016, `PERF-14`): `created_at` é o início da transação, então um lançamento commitado depois com `created_at` anterior à posição do cursor pode não aparecer nessa paginação; ele aparece numa nova leitura a partir do topo.

## Critérios de aceite

### STM-AC-01: Ordem decrescente
- **Dado** uma conta com abertura e 5 transferências (entradas e saídas)
- **Quando** `GET /v1/accounts/{id}/statement`
- **Então** `200` com `items` ordenados do mais recente para o mais antigo, o último sendo o `OPENING`, e os `balanceAfterCents` consistentes com a sequência
- Nível: e2e

### STM-AC-02: Paginação
- **Dado** uma conta com 45 lançamentos
- **Quando** o cliente percorre o extrato com `limit=20`
- **Então** recebe páginas de 20, 20 e 5 itens; `nextCursor` é `null` só na última; sem `limit`, a página tem 20 itens; `limit=0` ou `limit=101` → `400 VALIDATION_ERROR`
- Nível: e2e

### STM-AC-03: Cursor malformado
- **Dado** um `cursor` que não é base64url válido, ou que decodifica para algo fora do formato esperado
- **Quando** `GET /v1/accounts/{id}/statement?cursor=...`
- **Então** `400 INVALID_CURSOR`
- Nível: e2e + unitário no codec do cursor

### STM-AC-04: Conta inexistente
- **Dado** um UUID que não corresponde a nenhuma conta
- **Quando** `GET /v1/accounts/{id}/statement`
- **Então** `404 ACCOUNT_NOT_FOUND` (e não uma página vazia)
- Nível: e2e

### STM-AC-05: Estabilidade com novos lançamentos
- **Dado** uma conta com 30 lançamentos commitados
- **Quando** o cliente lê a primeira página (`limit=10`), outras 5 transferências são concluídas, e o cliente segue o `nextCursor` até o fim
- **Então** os 30 lançamentos originais aparecem exatamente uma vez cada, sem duplicatas, e os 5 novos não aparecem nas páginas seguintes (estão "acima" do cursor)
- Nível: integração

### STM-AC-06: Contraparte e tipos
- **Dado** uma transferência de A para B
- **Quando** consultados os extratos de A e de B
- **Então** A tem um `DEBIT` com `counterpartyAccountId = B` e B tem um `CREDIT` com `counterpartyAccountId = A`, ambos com o mesmo `transferId` e `amountCents` positivo
- Nível: e2e

## Casos de erro

| Situação | Status | `code` |
|---|---|---|
| `accountId` não é UUID, `limit` fora de 1–100 | 400 | `VALIDATION_ERROR` |
| Cursor inválido | 400 | `INVALID_CURSOR` |
| Sem/inválida `x-api-key` | 401 | `UNAUTHORIZED` |
| Conta não encontrada | 404 | `ACCOUNT_NOT_FOUND` |

## Requisitos não funcionais

- **STM-NFR-01:** p95 < 100 ms por página para uma conta com 100 mil lançamentos (ambiente local), com o plano usando o índice `(account_id, created_at desc, id desc)` (verificado por `EXPLAIN` no teste de integração; `PERF-11`).
- **STM-NFR-02:** nenhuma contagem total (`COUNT(*)`) é calculada por requisição.

## Riscos relacionados

`SEC-16`, `PERF-11`, `PERF-14`.
